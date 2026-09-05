# Inspector Feedback — Iteration 4

## Verdict: FAIL

## Acceptance Criteria Check

- [x] Linear ancestry and migration boundary — verified: exact inspected `HEAD` is
  `36eec84a0be9898057582588b6814864d8790855`; its merge-base with
  `29eaf1087e3b59ff5184edf8337da340396515c8` is exactly that baseline,
  the ancestor check passes, and no migration or generated data path is changed.
- [ ] Shared closed evaluator — FAILED in one remaining edge: required top-level
  members, setting domains, catalog-bound positive rule versions, schema-appropriate
  modes, and stable error codes are now rejected correctly. However,
  `evaluateCampaignRules(null)` returns a decision with `surface: "unknown"`, while
  `isClosedRuleDecision()` rejects every surface outside its closed `_SURFACES` set.
  The evaluator can therefore emit an output that its own output contract rejects.
- [ ] Truthful Enforced catalog surfaces — FAILED in documentation/evidence:
  the catalog and carry contract now narrow the two Enforced carry rules to
  `characterOpen`, `characterWrite`, DM projection, and Hub administration, and the
  carry contract truthfully describes calculation/identity enforcement without
  over-capacity blocking. But `docs/hub/implementation-status.md` still states that
  campaign-policy “enforcement remains explicitly out of scope,” contradicting its
  new Enforced-carry statement. The PR also claims destination-transition proof that
  does not exist for PostgreSQL or an active-policy real-stack transition.
- [x] Composition and lifecycle replacement — verified: normal activation,
  teardown, ordering, personal-setting composition, fail-closed replacement, and
  recovery are present. `_onHubRealtimeConnectionState({state: "live"})` now invokes
  `_pRefreshHubRules()` when blocked, that handler is registered on the real
  coordinator `connectionState` signal, and the focused test drives the live handler
  after a failed fetch.
- [x] Character Sheet runtime/builder behavior — verified: supported Character Sheet
  calculations consume composed settings, the TGTT master projection consistently
  gates its subsettings, and full unit plus real-stack Character Sheet paths pass.
  Builder/Level Up/Quick Build/Respec choice enforcement is no longer claimed for the
  two Enforced carry rules.
- [x] DM/party projection parity — verified: the Party Tracker consumes the same
  transient evaluated settings, preserves personal serialization and privacy
  boundaries, and its focused/full tests pass.
- [x] Authoritative atomic server fencing — verified by implementation: memory and
  PostgreSQL create/patch fetch the active rules identity inside their write
  authority; transition code resolves the destination rules and brew identity and
  removes an untrustworthy carry block before clone/move mutation. PostgreSQL performs
  this inside its transaction and locked destination snapshot. Missing behavioral
  parity is recorded separately below.
- [x] Protocol-4/legacy compatibility — verified: schema-v2 policy-sensitive carry
  writes require protocol 4 and an exact campaign basis, while schema-v1 and writes
  without policy-sensitive carry preserve legacy behavior.
- [x] Non-destructive documents/serialization — verified: campaign overlays remain
  transient; transition preparation clones the data and removes only derived carry
  authority on an identity mismatch; local documents and personal settings are not
  rewritten or serialized with campaign values.
- [ ] Required deterministic coverage and store parity — FAILED: memory and
  PostgreSQL now share behavioral stale-create plus detached-basis/old-protocol patch
  cases, but still lack the requested common create-and-patch matrix for missing,
  detached, stale, and current bases; omitted, old, and current protocols; successful
  current patches; and no-partial revision/event/receipt evidence. PostgreSQL has no
  behavioral active-policy clone/move transition test at all. The real-stack
  clone/attach/move journey creates both campaigns without activating rules, so it
  does not prove the policy-sensitive destination path. The latest brew-identity
  transition branch also has no focused rotated-brew test.
- [ ] Required mutation evidence — FAILED: all written mutants are killed, including
  the new setting-domain and applied-rule-catalog mutants. The purported
  `character-rules-teardown-disabled` mutant still changes only
  `getClearedCampaignRulesState()` in the evaluator, not Character Sheet
  `_clearHubRules()`, replacement, or reconnect behavior. The server mutants still
  disable the shared authority helper rather than independently removing the memory
  and PostgreSQL transactional call sites, and no destination-transition/brew fence
  mutant exists.
- [ ] Full validation — FAILED: Hub, mutation, full unit, ESLint, Stylelint, Sass,
  service-worker/build, audit, secret, SBOM, PostgreSQL runtime-role, Chromium
  real-stack, and exact-head CI gates pass in this inspection. `npm run test:data`
  exits 1 with 423 LinkCheck messages. This is the same pre-existing failure in
  unchanged, scope-forbidden generated crafting/bestiary data documented at baseline,
  so it is not a campaign-rule regression; it is nevertheless neither a passing gate
  nor an environment block. Prior exact-head real-stack reruns also demonstrate
  unrelated UI timing flakes even though this fresh run passed all 23 Chromium tests.
- [ ] Independent exact-head Inspector pass — FAILED: this review found remaining
  closed-output, documentation, parity, mutation, and validation blockers.
- [ ] Draft PR/remote/CI/final handoff — FAILED in part: PR #241 is the sole open
  draft against `multiplayer-hub`, no review is requested, remote head matches the
  inspected SHA, all four exact-head checks are terminal/successful, and the tree is
  clean. Its body still says terminal CI “is being awaited” rather than recording the
  terminal result, and it overstates destination-transition evidence despite having
  no active-policy PostgreSQL or real-stack transition case.

## Quality Gate

- `npm run test:hub` — PASS: 94 suites passed, 4 skipped; 1,254 tests passed.
- `npm run test:hub:mutations` — PASS as written: 7/7 active-context mutants,
  17/17 campaign-policy mutants, and 2/2 authority mutants were killed; the
  owner/path-specific gaps above remain.
- `npm run test:unit` — PASS: 678 suites passed, 6 skipped; 17,812 tests passed.
- `npm run test:js` — PASS.
- `npm run test:css:lint` — PASS.
- `npx sass scss/dmscreen.scss css/dmscreen.css` — PASS in a disposable exact-HEAD
  worktree.
- `npm run build:sw` — PASS in that disposable exact-HEAD worktree.
- `npm run build` — PASS in that disposable exact-HEAD worktree.
- `npm run test:data` — **FAIL**: 423 LinkCheck messages from the unchanged
  generated crafting/bestiary baseline.
- `npm run test:hub:e2e:stack` — PASS on this run: all 4 runtime-role PostgreSQL
  suites/26 tests and all 23 Chromium tests passed.
- `npm audit --omit=dev --audit-level=high` — PASS: 0 vulnerabilities.
- `npm run hub:check-secrets` — PASS.
- `npm sbom --omit=dev --sbom-format=cyclonedx` — PASS.
- Exact-head CI for PR #241 — PASS: `unit-and-supply-chain`,
  `affected-regressions`, `migration-and-roles`, and `real-stack-e2e` are all
  completed/successful.

## Issues Found

1. **Mutation evidence still does not mutate the required owners.** The Character
   Sheet teardown/replacement/reconnect code and each store's transaction fence must
   be independently disabled and killed, rather than testing an evaluator cleanup
   object and the shared helper only.
2. **Store parity is incomplete.** Add one common behavioral matrix for memory and
   PostgreSQL create/patch, including all basis/protocol states, successful current
   patching, and complete no-partial evidence. Add active-policy destination
   clone/attach/move coverage in PostgreSQL and the production-derived stack.
3. **The evaluator emits one non-closed error decision.** Normalize invalid input to
   a declared surface (or include a documented error surface in the closed contract)
   so every returned decision satisfies the evaluator's own output validator.
4. **Documentation and handoff are not fully truthful.** Remove the stale blanket
   “enforcement remains explicitly out of scope” statement, narrow evidence claims to
   tests that actually exist, and update the draft PR with terminal CI results.
5. **The mandatory data gate remains red.** The failure is pre-existing and fixing
   the generated files is expressly out of scope, but the acceptance criterion does
   not permit calling a non-environment baseline failure a pass.

## What Must Be Fixed

- Add actual Character Sheet lifecycle and per-store transaction/destination mutants.
- Complete memory/PostgreSQL create/patch and active-policy transition parity.
- Make every evaluator result satisfy the closed output contract.
- Reconcile the remaining stale enforcement documentation and exact PR evidence.
- Resolve or explicitly refine the impossible scope-versus-`test:data` acceptance
  conflict; do not misrepresent the baseline failure.
