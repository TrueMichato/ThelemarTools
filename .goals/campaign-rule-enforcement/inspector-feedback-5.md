# Inspector Feedback — Iteration 5

## Verdict: FAIL

## Acceptance Criteria Check

- [x] Linear ancestry and migration boundary — verified: exact inspected local and
  remote/PR head is `7d3e1c4f3e569368b238ea4c607e755552f4968e`; its merge-base with
  `29eaf1087e3b59ff5184edf8337da340396515c8` is exactly that baseline,
  the ancestor check passes, and the 50-file baseline diff changes neither migrations
  nor `data/crafting.json`.
- [ ] Shared closed evaluator — FAILED: required own decision fields, typed supported
  effective settings, catalog-bound applied rules, supported modes, and stable errors
  are validated. However, invalid non-null surfaces are copied into the blocked result.
  Direct exact-HEAD probes of `{surface: "not-a-surface"}` and `{surface: 42}` returned
  those invalid surfaces even though `isClosedRuleDecision()` accepts only `_SURFACES`.
  Embedding the first evaluator-produced result as `ruleDecision` caused the same
  evaluator to reject it with `RULES_VERSION_INVALID`. Therefore not every evaluator
  output satisfies its own closed output contract.
- [x] Truthful Enforced catalog surfaces — verified: only carry weight and encumbrance
  tiers are Enforced, their catalog surfaces are narrowed to character open/write and
  Hub administration (with DM projection mapped to character-open evaluation), and
  Builder/Level Up/content enforcement remains Advisory or Planned. Carry and
  implementation-status documentation now describe calculation/policy-identity
  enforcement without claiming over-capacity blocking.
- [x] Composition and lifecycle replacement — verified: focused tests drive a failed
  refresh followed by the real `connectionState: live` handler, which invokes a fresh,
  generation-fenced `_pRefreshHubRules()` and installs the new context without
  resurrecting stale rules. Activation, rollback, switch, teardown, and ordering
  coverage also passes.
- [x] Character Sheet runtime/builder behavior — verified: supported calculations use
  the transient evaluated projection, local serialization remains personal, and the
  destination-local-copy test resolves the destination context, recalculates a cloned
  state, and leaves the local document unchanged.
- [x] DM/party projection parity — verified: the same evaluated projection feeds Party
  Tracker/DM carry behavior while privacy and personal serialization remain intact.
- [x] Authoritative atomic server fencing — verified by implementation and focused
  behavior: memory and PostgreSQL create/patch evaluate the active policy within their
  authority, and clone/move resolve destination policy before retaining or removing
  derived carry data.
- [x] Protocol-4/legacy compatibility — verified: policy-sensitive schema-v2 carry
  writes require protocol 4 and the active campaign basis, while schema-v1 and
  non-policy-sensitive legacy paths remain compatible.
- [x] Non-destructive documents/serialization — verified: policy overlays are
  transient; destination preparation clones data and removes only derived carry
  authority when identities differ.
- [ ] Required deterministic coverage and store parity — FAILED: exact HEAD expands
  patch coverage in both stores for missing, detached, stale, omitted-protocol,
  old-protocol, and successful current writes, with no-partial revision/event evidence.
  Create coverage is still only stale rejection plus current success, not the requested
  matching basis/protocol matrix. Memory and PostgreSQL cover active-policy clone/move,
  but the production-derived attach/clone/move test creates both campaigns without
  activating rules, so it does not exercise the active destination-policy path.
- [ ] Required mutation evidence — FAILED: exact-HEAD mutation runs kill malformed
  effective-setting/applied-rule mutants and the memory-store call-site mutant.
  The named Character Sheet teardown mutant still mutates only
  `getClearedCampaignRulesState()` in the evaluator; there is no mutation of the actual
  Character Sheet teardown/replacement/reconnect owner. PostgreSQL create/patch
  call-sites and destination-transition ownership are also not independently mutated.
- [x] Full validation within the explicit scope boundary — verified: exact-HEAD Hub,
  focused Character Sheet/evaluator/authority, and mutation suites pass, and all four
  exact-head CI checks are terminal SUCCESS. `npm run test:data` still exits 1 with
  424 LinkCheck messages, but baseline and HEAD produce the same count and the relevant
  forbidden generated data blobs are identical. Per the explicit scope boundary, this
  pre-existing generated-data failure is documented rather than treated as a request
  to modify `data/crafting.json`.
- [ ] Independent exact-head Inspector pass — FAILED: the self-invalid evaluator
  output and required evidence gaps above remain at the exact remote head.
- [ ] Draft PR/remote/CI/final handoff — FAILED in part: PR #241 is the sole open draft
  against `multiplayer-hub`, its head is the exact inspected SHA, its body records
  ancestry/diff/rule/evidence/collision details, and all four checks are terminal
  SUCCESS. The checked-out workspace nevertheless contains eight unstaged product/test
  modifications, so the body's “Working tree is clean” handoff is not true at
  inspection time.

## Quality Gate

- `npm run test:hub` at clean exact HEAD — PASS: 94 suites passed, 4 skipped;
  1,255 tests passed.
- Focused Character Sheet/evaluator/authority Jest — PASS: 4 suites/71 tests.
- `npm run test:hub:mutations` at clean exact HEAD — PASS as written: 7/7
  active-context, 18/18 campaign-policy, and 2/2 authority mutants killed.
- `npm run test:data` at exact HEAD — FAIL: 424 LinkCheck messages; the baseline run
  has the same count and the prohibited generated data is unchanged.
- Exact-head PR #241 CI — PASS: `unit-and-supply-chain`,
  `affected-regressions`, `migration-and-roles`, and `real-stack-e2e` are all
  completed successfully.

## Issues Found

1. **The evaluator still emits output rejected by its own contract.**
   `blocked()` returns the caller-provided invalid surface. Normalize every blocked
   decision to a declared surface (or add a declared error surface), and assert
   self-validation for every return branch, including arbitrary invalid surface types.
2. **Create/store parity is incomplete.** Apply the same missing/detached/stale/current
   basis and omitted/old/current protocol matrix to create and patch in memory and
   PostgreSQL, with successful current writes and no document/revision/event/receipt
   changes after each rejection.
3. **Production-derived transition evidence does not activate policy.** Publish policy
   in the source and destination campaigns before attach/clone/move, then assert the
   destination result drops stale carry authority.
4. **Mutation evidence still misses the actual owners.** Mutate and kill Character
   Sheet teardown/reconnect, PostgreSQL create/patch fence call-sites, and destination
   transition preparation rather than relying on the evaluator cleanup helper or source
   inspection.
5. **The final clean-state claim is stale.** Eight unstaged product/test files are
   present in the requested workspace and are not part of exact remote HEAD.

## What Must Be Fixed

- Make every evaluator return value satisfy the closed decision validator.
- Complete the create/patch basis/protocol parity matrix and active-policy real-stack
  attach/clone/move evidence.
- Add owner-specific lifecycle, PostgreSQL fence, and destination-transition mutants.
- Commit the intended fixes normally, push the new exact head, rerun terminal CI, and
  update the draft PR's exact-head/clean-state evidence.
