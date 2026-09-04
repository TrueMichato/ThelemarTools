# Inspector Feedback — Iteration 7

## Verdict: FAIL

## Acceptance Criteria Check

- [x] Linear ancestry and migration boundary — verified: the exact pre-Inspector local,
  remote, and PR head was `f261bdd557490b178a1bbf116e61fd7f9a0e0293`;
  `29eaf1087e3b59ff5184edf8337da340396515c8` is its merge-base and
  ancestor. The 53-file baseline diff changes no migration or
  `data/crafting.json`.
- [x] Shared closed evaluator — verified by the prior exact-product inspection; the
  post-feedback changes touch only mutation evidence and process artifacts.
- [x] Truthful Enforced catalog surfaces — verified by the prior exact-product
  inspection; only supported carry rules are Enforced and content-gating entries
  remain Planned.
- [x] Composition and lifecycle replacement — verified by the prior focused lifecycle
  evidence; no product implementation changed after that inspection.
- [x] Character Sheet runtime/builder behavior — verified by the prior exact-product
  inspection and unchanged exact-head implementation.
- [x] DM/party projection parity — verified by the prior exact-product inspection and
  unchanged exact-head implementation.
- [x] Authoritative atomic server fencing — verified by implementation, prior memory/
  PostgreSQL behavioral matrices, and the now-executing owner probes.
- [x] Protocol-4/legacy compatibility — verified by the prior exact-product inspection
  and unchanged exact-head implementation.
- [x] Non-destructive documents/serialization — verified by the prior exact-product
  inspection and unchanged exact-head implementation.
- [x] Required deterministic coverage and store parity — verified by the prior memory/
  PostgreSQL and production-derived transition evidence; exact-head CI is terminal
  successful.
- [ ] Required mutation evidence — FAILED: the real mutation run reports 7/7
  active-context, 23/23 campaign-policy, and 2/2 authority mutants killed, and the
  copied parser/utils/CharacterSheetState dependencies allow the owner probes to run.
  However, a runtime `ReferenceError` from an owner operation is still converted by
  `assert.rejects(..., predicate)` into `AssertionError [ERR_ASSERTION]`, which
  `isProbeAssertionFailure()` accepts as a kill. A diagnostic copy that replaced the
  PostgreSQL create owner with a synthetic `ReferenceError` still printed
  `postgres-create-policy-fence-disabled: KILLED` and exited successfully.
- [x] Full validation within the explicit scope boundary — verified: the mutation
  command completes and all four exact-head PR checks are terminal SUCCESS.
  `test:data` remains the accepted identical baseline/HEAD failure in unchanged,
  scope-forbidden generated data.
- [ ] Independent exact-head Inspector pass — FAILED because infrastructure errors
  can still be misclassified as owner-mutant kills.
- [ ] Draft PR/remote/CI/final handoff — FAILED in truthfulness only: PR #241 is the
  sole open draft against `multiplayer-hub`, has exact head, no requested reviews,
  no ready/merge event, and four terminal successful checks. Its exact 53-file,
  3,270-addition, 153-deletion diff is current, but its mutation claim remains
  overstated until runtime infrastructure errors cannot count as kills.

## Quality Gate

- `npm run test:hub:mutations` — nominal PASS: 7/7 active-context, 23/23
  campaign-policy, and 2/2 authority mutants reported killed.
- Synthetic infrastructure diagnostic — **FAIL**: a PostgreSQL owner operation
  throwing `ReferenceError("synthetic infrastructure failure")` was reported as a
  killed mutant and the runner exited 0.
- Node assertion diagnostic — confirmed `assert.rejects()` wraps that
  `ReferenceError` as `{name: "AssertionError", code: "ERR_ASSERTION"}` with the
  original error in `error.actual`.
- Exact-head PR CI — PASS: `unit-and-supply-chain`, `affected-regressions`,
  `migration-and-roles`, and `real-stack-e2e` are all completed/successful.

## Issues Found

1. **Runtime infrastructure failures can still count as kills.**
   `probePostgresCreateFence()` and `probePostgresPatchFence()` put the real store
   promise directly inside `assert.rejects()` with a stale-policy predicate. When the
   operation rejects with `ReferenceError` (or another unexpected operational error),
   Node wraps the predicate mismatch in `AssertionError`. The outer runner checks only
   the wrapper name/code and therefore counts the infrastructure failure as a valid
   mutant kill. The same pattern exists in other rejection-based probes.
2. **The PR handoff overstates mutation robustness.** Imports now succeed and the
   checked owner operations execute, but the statement that fixture/import errors
   cannot count as kills is not yet true for runtime errors hidden by assertion
   wrappers.

## What Must Be Fixed

- Preserve and inspect the original rejection before classifying a probe failure.
  Explicitly rethrow `ERR_MODULE_NOT_FOUND`, `SyntaxError`, and `ReferenceError`
  whether they arise during import or during the exercised operation.
- Make kill classification distinguish an expected behavioral assertion from any
  unexpected store/runtime error, then add a self-test proving such infrastructure
  failures make the runner fail nonzero.
- Rerun mutations, push the normal Builder commit, await exact-head terminal CI, and
  update the draft PR evidence.
