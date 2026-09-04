# Inspector Feedback — Iteration 6

## Verdict: FAIL

## Acceptance Criteria Check

- [x] Linear ancestry and migration boundary — verified: the exact inspected local,
  remote, and PR head was `763f65a2e0474b72b84df4f605ced9cc08f77d64`;
  `29eaf1087e3b59ff5184edf8337da340396515c8` is its merge-base and ancestor.
  The 52-file baseline diff changes neither migrations nor `data/crafting.json`.
- [x] Shared closed evaluator — verified: invalid requested surfaces are normalized to
  `characterOpen`. Direct probes with a string, number, object, and nullish surface
  produced declared surfaces, and focused/full tests prove the decision contract.
- [x] Truthful Enforced catalog surfaces — verified in code and docs: only carry weight
  and encumbrance tiers are Enforced on their supported calculation/projection,
  policy-fenced write, and transition surfaces. Content-gating entries remain Planned,
  and incomplete rules remain Advisory.
- [x] Composition and lifecycle replacement — verified: campaign overlays remain
  transient, personal settings remain intact, and focused tests cover activation,
  rollback, switching, teardown, stale ordering, failed refresh, and reconnect recovery.
- [x] Character Sheet runtime/builder behavior — verified: supported runtime
  calculations consume the evaluated projection, while unsupported Builder/Level Up
  choice enforcement is not claimed. Explicit-local behavior remains compatible.
- [x] DM/party projection parity — verified: Party Tracker consumes the same evaluated
  settings, honors the TGTT master toggle, and preserves privacy and serialization
  boundaries.
- [x] Authoritative atomic server fencing — verified by implementation and behavioral
  tests: create/patch operations use active policy identity in both stores, and
  transitions prepare cloned destination data before mutation.
- [x] Protocol-4/legacy compatibility — verified: schema-v2 policy-sensitive carry
  writes require protocol 4 and current identity; schema-v1 and non-sensitive legacy
  paths remain compatible.
- [x] Non-destructive documents/serialization — verified: overlays do not serialize,
  and transitions remove only derived carry authority from a clone.
- [x] Required deterministic coverage and store parity — verified: memory and
  PostgreSQL tests cover missing/detached/stale/current bases, omitted/old/current
  protocol, successful current create/patch, unchanged character revision/event
  evidence on rejection, and active-policy attach/clone/move. The exact-head real-stack
  transition test activates source and destination policies and asserts removal of stale
  carry authority.
- [ ] Required mutation evidence — FAILED: the command reports all mutants killed, but
  the PostgreSQL create, PostgreSQL patch, and destination-transition owner mutants die
  before their probes run. A diagnostic exact-head rerun exposed
  `ERR_MODULE_NOT_FOUND` for the mutation sandbox's missing `js/parser.js`, imported by
  `server/src/character-derived-stats.js`. Thus these three results are false-positive
  infrastructure kills, not evidence that tests detect disabling those owners.
- [x] Full validation within the explicit scope boundary — verified: focused Hub,
  full unit, CSS lint, Sass, service-worker/build, and exact-head CI pass. Exact baseline
  and HEAD both emit 550 `Missing link:` lines from unchanged forbidden generated data;
  this known `test:data` scope conflict is documented and is not a request to change
  `data/crafting.json`.
- [ ] Independent exact-head Inspector pass — FAILED because required owner-specific
  mutation evidence is not valid.
- [ ] Draft PR/remote/CI/final handoff — FAILED only in truthfulness of evidence: PR
  #241 is the sole open draft against exact base/head, has no requested reviewers, all
  four exact-head checks are terminal SUCCESS, and the inspected tree was clean.
  However, its body claims independent PostgreSQL/destination mutants were killed when
  those probes actually failed on the missing sandbox module. It also reports 424
  LinkCheck messages, while fresh baseline and HEAD runs each emitted 550.

## Quality Gate

- `npm run test:hub` — PASS: 94 suites passed, 4 skipped; 1,256 tests passed.
- `npm run test:hub:mutations` — FAIL as evidence: nominally reports 7/7
  active-context, 23/23 campaign-policy, and 2/2 authority mutants killed, but three
  newly required owner mutants are killed by `ERR_MODULE_NOT_FOUND` before assertion.
- `npm run test:unit` — PASS: 678 suites passed, 6 skipped; 17,814 tests passed.
- `npm run test:css:lint` — PASS.
- Sass, `npm run build:sw`, and `npm run build` — PASS in a disposable exact-HEAD
  worktree.
- `npm run test:data` — known scope conflict: exits 1; exact baseline and HEAD each
  emit 550 identical `Missing link:` lines, and `data/crafting.json` has the same object
  identity at both revisions.
- Exact-head PR CI — PASS: `unit-and-supply-chain`, `affected-regressions`,
  `migration-and-roles`, and `real-stack-e2e` all completed successfully. This covers
  JavaScript lint, focused style lint, audit, secret scan, SBOM/image checks,
  runtime-role PostgreSQL, and the production-derived Chromium stack.

## Issues Found

1. **Three required owner mutants are false positives.** `loadVariant()` copies
   `js/hub` and the Character Sheet owner, but not `js/parser.js` and its required
   dependency surface. Importing `PostgresHubStore` therefore throws before
   `probeStoreFenceOwners()` or `probeTransitionOwners()` can inspect or exercise the
   mutation. The runner treats every thrown error as a killed mutant, so infrastructure
   failure is indistinguishable from a relevant assertion failure.
2. **The PR overstates mutation evidence.** The current exact-head handoff explicitly
   claims independent PostgreSQL/destination owner mutations are killed, which the
   diagnostic run disproves.

## What Must Be Fixed

- Make the mutation sandbox able to import the actual PostgreSQL and transition owners,
  or otherwise construct probes that reach those owners without unrelated import
  failures.
- Make mutation probes distinguish expected assertion failures from setup/import
  failures so infrastructure errors cannot count as kills.
- Re-run the mutation gate and update the draft PR evidence with the valid results and
  current baseline/HEAD LinkCheck count.
