# Inspector Feedback — Iteration 3

## Verdict: FAIL

## Acceptance Criteria Check

- [x] Linear ancestry and migration boundary — verified: exact inspected `HEAD` is
  `ffc8a295946511764cdfd06d5766d0e73f9270de`; its merge-base with
  `29eaf1087e3b59ff5184edf8337da340396515c8` is exactly that baseline,
  the ancestor check passes, and no migration path is changed.
- [ ] Shared closed evaluator — FAILED: input/version gates and rules-version identity
  matching are present, but decision-output validation remains incomplete.
  `getCampaignSettingsOverlay()` accepted both
  `{effectiveSettings: {enableTgtt: "yes", unexpected: true}}` and a decision whose
  `appliedRules` named `unknown.rule` with `ruleSchemaVersion: -1`. The validator does
  not close or type-check effective-setting keys/values, bind applied rules to the
  catalog, require positive supported rule schema versions, restrict error codes to the
  stable contract, or require every declared top-level field as an own property.
- [ ] Truthful Enforced catalog surfaces — FAILED: the two carry rules now describe
  enforcement as choosing the campaign calculation and fencing its peer-visible
  summary rather than blocking play for over-capacity, which is a defensible
  privacy-preserving meaning. However, `docs/hub/carry-contract.md` still says
  “Advisory only,” says the evaluator does not exist, and says the rule is Planned.
  The catalog also claims implemented Builder, Level Up, Quick Build, and Respec
  surfaces without focused behavioral evidence for carry on those surfaces.
- [ ] Composition and lifecycle replacement — FAILED: normal activation, teardown,
  ordering, identity-checked replacement, and personal-setting composition pass.
  Failed refresh now enters a recoverable internal state, but actual reconnect does not
  invoke `_pRefreshHubRules()`. The new test manually calls `_pRefreshHubRules()` a
  second time and labels that call “on reconnect”; `_onHubRealtimeConnectionState()`
  does not refresh on `live`, and a failed refresh after a delivered `rules.activated`
  event need not be replayed from the advanced realtime cursor.
- [x] Character Sheet runtime/builder behavior — verified: the inspected carry,
  jumping, Linguistics, reading, critical-roll, PDF, Builder, and Level Up paths consume
  composed settings and consistently honor the TGTT master projection. Explicit-local
  behavior remains unchanged in the passing full and real-stack suites.
- [x] DM/party projection parity — verified: Party Tracker uses the same evaluated
  transient settings, gates TGTT subrules with the master toggle, preserves personal
  serialization, and its focused parity tests pass.
- [ ] Authoritative atomic server fencing — FAILED in part: create and patch paths in
  memory and PostgreSQL fetch the active immutable policy inside their write authority,
  require protocol 4 and the campaign carry basis for schema-v2 policy-sensitive writes,
  and reject before canonical writes. Clone, attach, and move do not evaluate or re-pin
  the destination policy at all: both stores copy/move the source document and its old
  carry basis directly into the destination campaign.
- [x] Protocol-4/legacy compatibility — verified: current schema-v2 carry writes prove
  protocol 4; schema-v1/no-policy-sensitive legacy writes retain their prior behavior;
  focused Hub and production-derived real-stack tests pass.
- [x] Non-destructive documents/serialization — verified for evaluation and local copy:
  local-to-campaign copy
  fetches the destination context, applies its identity-checked transient overlay to a
  cloned `CharacterSheetState`, stamps the outgoing campaign carry basis, restores
  personal settings in serialization, and   does not mutate the local document. This does not cure the separate stale destination
  basis in server-side clone/attach/move.
- [ ] Required deterministic coverage and store parity — FAILED: exact-head tests add
  destination-copy behavior, failed-then-manual-refresh recovery, and PostgreSQL
  projection identity. They still do not behaviorally drive recovery from an actual
  reconnect event, nor provide common memory/PostgreSQL create-and-patch cases for
  detached/missing/stale bases, missing/old protocol, successful current writes, and
  no-partial-write results. Each store has only a stale-create integration case for the
  new fence, and there is no destination-policy matrix for clone, attach, or move.
- [ ] Required mutation evidence — FAILED: all written mutants are killed, including
  the new shallow decision guard mutant. The teardown mutant still changes only
  `getClearedCampaignRulesState()` rather than Character Sheet replacement/teardown,
  and server mutants still change the shared authority helper rather than independently
  disabling the memory and PostgreSQL transaction fences. There is no mutant for the
  accepted malformed effective-settings/applied-rule outputs or actual reconnect
  recovery.
- [ ] Full validation — FAILED: `npm run test:data` exits 1. This is not an environment
  block and is not a campaign-rule regression:
  clean detached worktrees at both the exact baseline and exact `HEAD` report the same
  424 LinkCheck messages/37 distinct lines in unchanged generated
  `data/crafting.json`/bestiary references. Fixing that unrelated generated content is
  out of scope and `goal.md` explicitly forbids modifying `data/crafting.json`; the
  failure is documented here rather than falsely called PASS. In addition, a fresh
  production-derived real-stack run at the inspected source failed 2/23 Chromium tests
  after all 4 runtime-role PostgreSQL suites passed. CI and an earlier Inspector run at
  the same SHA passed 23/23, so the gate is demonstrably nondeterministic rather than
  terminally green.
- [ ] Independent exact-head Inspector pass — FAILED: this exact-head review found
  blocking output-contract, reconnect, evidence, documentation, and handoff gaps.
- [ ] Draft PR/remote/CI/final handoff — FAILED in part: PR #241 is the sole draft PR
  against `multiplayer-hub`, its remote head exactly matches inspected `HEAD`, no review
  is requested, and all four CI checks are terminal/successful. Its body does not
  include the requested exact ancestry/diff, complete rule matrix, evidence, collision
  map, or clean-state handoff.

## Quality Gate

- `npm run test:hub` — PASS: 94 suites passed, 4 skipped; 1,247 tests passed.
- `npm run test:hub:mutations` — PASS as written: 7/7 active-context mutants,
  15/15 campaign-policy mutants, and both additional authority mutants were killed;
  the path-specific gaps above remain.
- `npm run test:unit` — PASS: 678 suites passed, 6 skipped; 17,805 tests passed.
- `npm run test:js` — PASS.
- `npm run test:css:lint` — PASS.
- `npx sass scss/dmscreen.scss css/dmscreen.css` — PASS in a disposable exact-HEAD
  worktree.
- `npm run build:sw` — PASS in that disposable exact-HEAD worktree.
- `npm run build` — PASS in that disposable exact-HEAD worktree.
- `npm run test:data` — **FAIL**: the exact baseline and exact HEAD both report the
  same pre-existing generated crafting/bestiary LinkCheck gaps. This is out of product
  scope, but it is neither a passing gate nor an environment block.
- `npm run test:hub:e2e:stack` — **FAIL on fresh rerun**: all 4 runtime-role PostgreSQL
  suites passed (26 tests), then Chromium finished 21 passed/2 failed. The failures were
  the Cure Wounds approval flow (no `applied` state observed) and the private-v1
  lifecycle (expected HP 11, observed 12). Exact-head CI and an earlier run passed, so
  this is nondeterministic evidence, not an environment block.
- `npm audit --omit=dev --audit-level=high` — PASS: 0 vulnerabilities.
- `npm run hub:check-secrets` — PASS.
- `npm sbom --omit=dev --sbom-format=cyclonedx` — PASS.
- Terminal CI for PR #241 — PASS: `unit-and-supply-chain`,
  `affected-regressions`, `migration-and-roles`, and `real-stack-e2e` all completed
  successfully.

## Issues Found

1. **Decision outputs are still not strictly closed.** The guard checks the outer
   shape but lets arbitrary/mistyped effective settings and unknown applied rules reach
   the Character Sheet overlay. Validate exact setting keys and value domains, catalog
   rule identities/schema/modes, required own fields, duplicates/bounds, and stable
   error codes before exposing an overlay; test and mutate those checks.
2. **The recovery test does not test reconnect.** A direct second refresh can now
   recover, but no production reconnect signal performs it. Trigger a fresh,
   identity-checked context load after the realtime client reaches a trustworthy live
   baseline (with generation/order fencing), and prove failure followed by an actual
   reconnect without relying on replay of an already-consumed activation event.
3. **Authority parity evidence is still too shallow.** Add the same behavioral create
   and patch matrix to memory and runtime-role PostgreSQL, including missing/detached/
   stale/current bases, omitted/old/current protocol, success, rejection, and no
   partial document/revision/event writes.
4. **Mutation evidence does not target the required owners.** Mutate the Character
   Sheet replacement/teardown and reconnect paths, plus each store's transactional
   fence independently. The new decision mutant must cover malformed allowed-key
   content, not only an object missing most top-level fields.
5. **Carry documentation contradicts the promoted product status.** Reconcile
   `docs/hub/carry-contract.md` with the privacy-preserving “enforced calculation and
   identity fence, non-blocking over-capacity” semantics and provide evidence for every
   surface marked implemented or narrow the surface claims.
6. **The PR handoff is incomplete.** Expand the sole draft PR description with exact
   ancestry/diff, the full rule-by-rule matrix, test/mutation evidence, collision map,
   and clean local/remote/PR state without marking it ready.
7. **Iteration commit discipline and trailers remain invalid.** Iteration 3 has four
   Builder commits instead of one. In each, a blank line separates `Assisted-by` from
   `Co-authored-by`, so Git parses only `Co-authored-by` as a trailer. Do not rewrite
   history; use correctly formatted contiguous trailers on future normal commits.
8. **Destination campaign transitions retain stale rule authority.** Memory and
   PostgreSQL clone/move paths transfer `source.data` without evaluating the destination
   rules version or replacing the carry basis. Cover clone, detached attach, and
   campaign-to-campaign move atomically in both stores and the real stack.
9. **The real-stack gate is not deterministic.** Although exact-head CI and an earlier
   Inspector run passed, this fresh run failed 2 of 23 Chromium tests. A required gate
   that passes only intermittently is not passing deterministic evidence.

## What Must Be Fixed

- Strictly validate every decision-output member and kill malformed-output mutants.
- Wire and behaviorally prove real failure-then-reconnect recovery.
- Add common memory/PostgreSQL create/patch authority parity and independent
  lifecycle/store-fence mutants.
- Re-pin or fail closed for clone/attach/move against the destination policy and prove
  those paths in both stores.
- Stabilize the two intermittently failing real-stack Chromium flows.
- Make carry status/docs/surface evidence truthful and consistent.
- Complete the requested final handoff on the existing draft PR.
- Keep future commits normal and use one contiguous trailer block.
