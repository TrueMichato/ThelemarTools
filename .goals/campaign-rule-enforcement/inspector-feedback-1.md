# Inspector Feedback — Iteration 1

## Verdict: FAIL

## Acceptance Criteria Check

- [x] Linear ancestry and migration boundary — verified: `HEAD` was
  `1e13701c0778b07119c80faf1499f3b9c33b4424`, the merge-base with
  `29eaf1087e3b59ff5184edf8337da340396515c8` was exactly that baseline,
  `git merge-base --is-ancestor` returned 0, and no migration path (including
  migration 0007) appears in the baseline-to-HEAD diff.
- [ ] Shared closed evaluator — FAILED: the evaluator exists and is pure/data-only,
  but its nested `rulesVersion` contract is not closed or fully version-gated. A
  rules version with `version: "not-a-version"`, `catalogVersion: 999`, and an
  unknown `unexpected` key evaluated as `compliant`; JSON serialization converted
  the resulting `policyIdentity.version` from `NaN` to `null`.
- [ ] Truthful Enforced catalog surfaces — FAILED: `tgtt.enabled` is labeled
  Enforced and marks builder, level-up, quick-build, respec, content filtering,
  character writes, and Hub administration as implemented while its own catalog
  text says downstream choice enforcement is not included. Server character writes
  do not enforce TGTT choice consequences. The three content-gating entries did
  correctly remain Planned.
- [ ] Composition and lifecycle replacement — FAILED: local serialization stripping
  and the normal `_clearHubRules()` path are present, but a failed realtime rule
  refresh only clears the state overlay and carry basis. It leaves the old
  `_hubContext` installed, so the next character load/reset can reapply the stale
  decision through `_getHubRulesOverlay(this._hubContext)`.
- [ ] Character Sheet runtime/builder behavior — FAILED: the projection reaches
  `getSettings()`, but the supported master-toggle behavior is not consistent.
  Character Sheet carry, jumping, Linguistics initialization, and critical-roll
  paths read their sub-toggle without consistently gating on `enableTgtt`.
- [ ] DM/party projection parity — FAILED: Party Tracker carry explicitly requires
  both `enableTgtt` and `thelemar_carryWeight`, while Character Sheet carry checks
  only `thelemar_carryWeight`. A valid policy can set `tgtt.enabled` false while
  leaving carry true, producing different effective behavior from the same decision.
- [ ] Authoritative atomic server fencing — FAILED: `assertCampaignRuleWriteFence`
  only derives the expected policy pin when `carry.basis.kind === "campaign"`.
  Direct probes showed both `{kind: "detached", rulesVersionId: "stale"}` and
  `{kind: "campaign", rulesVersionId: null}` were accepted against an active
  schema-v2 policy; only a non-null stale campaign id was rejected. This permits
  omission/downgrade of the fence instead of failing closed.
- [ ] Protocol-4/legacy compatibility — FAILED: create/update character routes accept
  protocol 3 and 4, do not pass the request protocol into either store, and the
  authority helper supplies protocol 4 internally. A policy-sensitive carry payload
  can therefore reach the v2 authority path without proving that the caller used
  protocol 4. Schema-v1 evaluator compatibility itself passed focused tests.
- [x] Non-destructive documents/serialization — verified: evaluation uses cloned
  data, campaign overlays are transient, and `CharacterSheetState.toJson()` restores
  the personal settings values rather than serializing overlay values.
- [ ] Required deterministic coverage and store parity — FAILED: no behavioral
  memory/PostgreSQL tests exercise the new write fence. The new “parity” assertion
  only searches both source files for a helper call. There are no focused schema-v2
  Character Sheet/Party Tracker tests for off/on/rollback/switch/realtime failure or
  stale ordering; the teardown test primarily constructs legacy raw-rule contexts.
- [ ] Required mutation evidence — FAILED: the added mutants cover evaluator
  capability/pin/blocked-overlay checks, but there is no mutant for Character Sheet
  decision teardown/replacement and no mutant disabling either memory or PostgreSQL
  server fencing.
- [ ] Full validation — FAILED: `npm run test:data` failed LinkCheck, and
  `npm run test:hub:e2e:stack` failed the real Chromium lifecycle because the
  production-derived policy UI now contains Enforced labels while its E2E contract
  still asserts that it does not. These are real gate failures, not environment
  blocks.
- [ ] Independent exact-head Inspector pass — FAILED: this review found blocking
  functional and evidence gaps.
- [ ] Draft PR/remote/CI/final handoff — FAILED: `gh pr list --head
  truemichato-campaign-rules-implementation --state all` returned `[]`, and
  `git ls-remote --heads origin truemichato-campaign-rules-implementation` returned
  no branch. There is no draft PR or terminal CI to inspect.

## Quality Gate

- `npm run test:hub` — PASS: 94 suites passed, 4 skipped; 1,233 tests passed.
- `npm run test:hub:mutations` — PASS as written: 7/7 active-context and 9/9
  rules-policy mutants killed, but required replacement/server-fence mutants are
  absent.
- Focused `CharacterSheetHubTeardown` — PASS: 16 tests.
- `npm run test:unit` — PASS: 678 suites passed, 6 skipped; 17,785 tests passed.
- `npm run test:js` — PASS.
- `npm run test:css:lint` — PASS.
- `npx sass scss/dmscreen.scss css/dmscreen.css` — PASS in an exact-HEAD detached
  build worktree to avoid modifying the inspected product tree.
- `npm run build:sw` — PASS in that exact-HEAD detached worktree.
- `npm run build` — PASS in that exact-HEAD detached worktree.
- `npm run test:data` — **FAIL**: LinkCheck reported unresolved links, including
  `data/bestiary/monstergroups.json` and `data/crafting.json`.
- `npm run test:hub:e2e:stack` — **FAIL**: runtime-role PostgreSQL suites passed
  (4 suites/24 tests), but Chromium finished 22 passed/1 failed. The failure was
  `private-v1.spec.ts`, where `HubCampaignPage.expectRulesPolicySelectionJourney`
  retained the old no-Enforced-label expectation.
- `npm audit --omit=dev --audit-level=high` — PASS: 0 vulnerabilities.
- `npm run hub:check-secrets` — PASS.
- `npm sbom --omit=dev --sbom-format=cyclonedx` — PASS.
- Syntax checks for the changed evaluator, Character Sheet, DM Screen, and authority
  modules — PASS.

## Issues Found

1. **Server policy fence is bypassable by omitting/downgrading the basis pin.**
   `assertCampaignRuleWriteFence()` treats a detached basis or null campaign pin as
   “no expected pin” even when the server knows a schema-v2 policy is active. Both
   stores then accept the write. Require the campaign basis and exact active immutable
   identity for policy-sensitive current-client writes, while preserving legacy
   no-carry handling explicitly.
2. **Failed realtime replacement can resurrect stale rules.** The Character Sheet
   refresh catch path does not clear/fence `_hubContext`. Use the same complete rules
   teardown invariant as `_clearHubRules()` (or enter an explicit blocked state) and
   test blocked, fetch-failure, stale-order, switch, rollback, access-loss, BFCache,
   and reconnect paths.
3. **Evaluator wrapper validation is incomplete.** Close and validate the complete
   rules-version envelope, including finite/integer version identity, catalog identity,
   allowed keys, and stable fail-closed errors. Add tests/mutants for each gate.
4. **The Enforced matrix overclaims support.** Either implement and prove every
   claimed `tgtt.enabled` surface—including authoritative write consequences—or
   downgrade incomplete surfaces/rules to Advisory. Resolve the Character Sheet versus
   Party Tracker master-toggle inconsistency.
5. **Required evidence is missing.** Add behavioral memory/PostgreSQL fence parity,
   schema-v2 Character Sheet and Party Tracker lifecycle/composition tests, and
   independent mutants for decision replacement/teardown and server fencing.
6. **Validation and delivery are incomplete.** Update the real-stack UI contract,
   make all required gates pass (including data validation), then push exactly one
   branch, open exactly one draft PR against `multiplayer-hub`, await terminal CI, and
   provide the requested rule/evidence/collision/remote handoff.
7. **Iteration commit rules were violated.** There are two commits after the exact
   baseline. The second, `chore(hub): remove generated collateral`, has neither the
   required `[B]` marker nor `Assisted-by: OpenAI:GPT-5.6 Luna`. Do not rewrite
   history; correct process compliance with normal follow-up commits as allowed by the
   orchestrator.

## What Must Be Fixed

- Close the evaluator envelope and add stable fail-closed tests.
- Make the active-policy carry fence non-optional and protocol-aware in both stores.
- Prevent stale `_hubContext` resurrection after any replacement failure.
- Align TGTT master/sub-rule behavior across Character Sheet, all build flows, DM
  projections, and server claims; downgrade any unproven Enforced surface.
- Add real behavioral parity/lifecycle tests and the missing teardown/server mutants.
- Fix the failing data and real-stack gates.
- Complete the draft-PR, remote, terminal-CI, handoff, and commit-rule requirements
  without rewriting history.
