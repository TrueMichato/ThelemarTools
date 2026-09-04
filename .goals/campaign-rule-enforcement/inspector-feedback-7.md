# Inspector Feedback — Iteration 7

## Verdict: FAIL

## Acceptance Criteria Check

- [x] Linear ancestry and migration boundary — verified at the requested pre-Inspector
  product HEAD `af88234555674ea25cc11c8ac7f3b91553e3dcaa`: its merge-base with
  `29eaf1087e3b59ff5184edf8337da340396515c8` is exactly that baseline,
  the ancestor check succeeds, history is linear, and the 54-file product diff changes
  no migration or generated-data path.
- [x] Shared closed evaluator — verified by direct focused tests and code inspection:
  the data-only evaluator closes decision fields, setting domains, rule/catalog/schema
  identities, stable errors, capabilities, protocol, and policy pins.
- [x] Truthful Enforced catalog surfaces — verified in product docs and tests: only
  carry weight and encumbrance tiers are Enforced; incomplete TGTT/exhaustion behavior
  remains Advisory and source/species/edition rules remain Planned.
- [x] Composition and lifecycle replacement — verified: focused tests pass for
  activation, rollback, replacement failure, reconnect recovery, stale ordering,
  teardown, and transient composition without personal-setting mutation.
- [x] Character Sheet runtime/builder behavior — verified by the passing focused and
  full suites; unsupported Builder/Level Up choice enforcement is not claimed.
- [x] DM/party projection parity — verified by the shared evaluated projection and the
  passing Party Tracker campaign-rules tests.
- [x] Authoritative atomic server fencing — verified by memory behavior, runtime-role
  PostgreSQL tests, and owner probes for create, patch, and destination transition.
- [x] Protocol-4/legacy compatibility — verified by focused evaluator and authority
  coverage for protocol, policy identity, schema-v1, and non-sensitive legacy paths.
- [x] Non-destructive documents/serialization — verified: overlays remain transient,
  transition preparation clones data, and only stale derived carry authority is removed.
- [x] Required deterministic coverage and store parity — focused suites pass, and exact
  HEAD CI runs the PostgreSQL parity and production-derived transition journeys.
- [x] Required mutation evidence — verified directly. `js/parser.js`, `js/utils.js`,
  Character Sheet state/class dependencies, both stores, and transition owners load in
  the sandbox. Instrumented copies proved PostgreSQL create/patch reach their operations
  and reject with the post-fence sentinel when mutated, while the destination clone
  completes before its assertion kills the mutant. Removing `js/parser.js` and injecting
  a runtime `ReferenceError` both make the runner exit nonzero instead of counting kills.
- [x] Full validation within the explicit generated-data boundary — all applicable
  local gates and exact-head CI pass except `test:data`. Fresh locked baseline and HEAD
  runs each exit 1 with exactly 424 identical `Missing link:` lines, SHA-256
  `1622bd9307fc5451484d0cde9c751b3b14e5873010cf72a9313fcd11e25eefe4`,
  solely from unchanged `data/crafting.json` and
  `data/bestiary/monstergroups.json`.
- [ ] Independent exact-head Inspector pass — FAILED because the current PR handoff
  misstates independently verified gate evidence.
- [ ] Draft PR/remote/CI/final handoff — FAILED in truthfulness only: PR #241 is the sole
  open draft for the branch, targets `multiplayer-hub`, has no requested review, no
  ready/merge event, and exact-head run `33927391157` is terminal successful. However,
  its body says baseline and HEAD have 550 missing-link lines when fresh locked runs have
  424, and says all 23 Chromium tests passed without disclosing the actual Playwright
  result of 21 passed and 2 flaky (both passing only on retry).

## Quality Gate

- `npm run test:hub` — PASS: 94 suites passed, 4 skipped; 1,256 tests passed.
- Focused evaluator/lifecycle/Character Sheet/DM/authority Jest — PASS:
  5 suites passed, 1 environment-skipped; 74 tests passed.
- `npm run test:hub:mutations` — PASS: 7/7 active-context, 23/23
  campaign-policy, and 2/2 authority mutants killed.
- Missing-parser diagnostic — PASS: exited nonzero with `ERR_MODULE_NOT_FOUND`.
- Synthetic PostgreSQL-owner `ReferenceError` diagnostic — PASS: exited nonzero with
  `probe failed before its assertion` and preserved the original error as its cause.
- `npm run test:unit` — PASS: 678 suites passed, 6 skipped; 17,814 tests passed.
- `npm run test:js` and `npm run test:css:lint` — PASS.
- Sass, `npm run build:sw`, and `npm run build` — PASS in a disposable exact-HEAD
  worktree.
- `npm audit --omit=dev --audit-level=high`, `npm run hub:check-secrets`, and locked
  `npm sbom --omit=dev --sbom-format=cyclonedx` — PASS.
- `npm run test:data` — expected scope exception, not a pass: baseline and HEAD each
  have the same 424-line failure in the two unchanged forbidden generated-data files.
- Exact-head CI run `33927391157` — terminal SUCCESS for all four jobs. Runtime-role
  PostgreSQL passed 4 suites/26 tests. Chromium completed with 21 passed and 2 flaky.

## Issues Found

1. **The PR body gives the wrong `test:data` evidence.** It reports 550 missing-link
   lines. Two fresh `npm ci` worktrees at the exact baseline and exact product HEAD each
   produce 424 identical lines with the hash recorded above.
2. **The PR body overstates the Chromium result.** The terminal job is successful, but
   its Playwright summary is `2 flaky` and `21 passed`, not an unqualified clean pass of
   all 23 tests. The flaky tests are the BFCache membership-removal lifecycle and the
   private-v1 lifecycle.

## What Must Be Fixed

- Correct PR #241's data-gate count to 424 and retain the exact baseline/HEAD identity,
  unchanged-file scope, and failing status.
- Report the terminal real-stack result accurately as 21 passed and 2 flaky (both
  successful on retry), or obtain a clean deterministic rerun before claiming all 23
  passed.
- Do not mark ready, request review, merge, or rewrite history.
