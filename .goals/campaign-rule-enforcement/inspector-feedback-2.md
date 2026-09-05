# Inspector Feedback — Iteration 2

## Verdict: FAIL

## Acceptance Criteria Check

- [x] Linear ancestry and migration boundary — verified: `HEAD` is
  `03f76e03d78b60b2af0158c4cb2e133e009e8816`; its merge-base with
  `29eaf1087e3b59ff5184edf8337da340396515c8` is exactly that baseline,
  `git merge-base --is-ancestor` succeeds, and the baseline-to-HEAD diff contains
  no migration path.
- [ ] Shared closed evaluator — FAILED: input-envelope, identity, schema, catalog,
  capability, protocol, pin, surface, and combination gates now fail closed, and
  schema-v1/local tests pass. The output guard is not a validator, however:
  `isClosedRuleDecision()` checks only for unknown keys. A `compliant` object
  containing only allowed keys, but missing `schemaVersion`, `evaluatorVersion`,
  `surface`, `appliedRules`, and `errors`, is accepted by both overlay helpers and
  can apply arbitrary `effectiveSettings`. The realtime refresh path calls the
  weaker direct helper as well.
- [ ] Truthful Enforced catalog surfaces — FAILED: the catalog now truthfully
  downgrades `tgtt.enabled` to Advisory and retains the three content-gating rules
  as Planned, but the two remaining Enforced carry rules are not end-to-end usable
  on all claimed operations. A local-to-campaign cloud copy serializes a detached
  carry basis and does not first evaluate/stamp the destination policy, so the new
  mandatory write fence prevents the real workflow from completing. In addition,
  `getCarryEnforcement()` and its tests still explicitly define enforced carry as
  unavailable and never blocking, contradicting the promoted product label.
- [ ] Composition and lifecycle replacement — FAILED: personal-setting composition,
  serialization stripping, normal teardown, failed-refresh teardown, replacement,
  and stale-order tests pass. However, failed realtime refresh calls
  `_clearHubRules()`, which nulls `_hubContext`; every later refresh then returns at
  the `!this._hubContext` guard. There is no tested reconnect recovery or explicit
  blocked state, so a transient fetch failure cannot recompute rules without a
  reload.
- [ ] Character Sheet runtime/builder behavior — FAILED: the TGTT master toggle now
  consistently gates the inspected carry, jumping, Linguistics, reading, critical
  roll, and PDF paths, and local unit tests pass. The production-derived
  local-to-campaign copy path still times out because it sends the local character's
  detached carry basis into a destination with an active schema-v2 policy; later
  browser logs also contain `HubApiError: RULES_VERSION_INVALID`.
- [x] DM/party projection parity — verified: focused schema-v1/v2 Party Tracker tests
  prove transient composition, serialization isolation, and master-toggle parity.
  The actual normalized PostgreSQL carry-basis envelope also evaluates successfully
  in a direct exact-head probe; the real-stack failures are in Character Sheet
  workflows, not evidence of a DM projection-envelope defect.
- [x] Authoritative atomic server fencing — verified: request protocol is passed into
  both stores; active schema-v2 carry writes require a campaign basis with the exact
  active immutable rules id and protocol 4. Direct, memory, and PostgreSQL stale
  create probes reject before a write, and the relevant authority mutants are killed.
- [x] Protocol-4/legacy compatibility — verified: the routes pass the request
  protocol into both stores; focused schema-v1/no-carry legacy behavior passes, and
  schema-v2 carry writes reject protocol 3 or an omitted protocol while accepting
  protocol 4. The broken current-client cloud-copy preparation is recorded
  separately and does not show a protocol-3 compatibility regression.
- [x] Non-destructive documents/serialization — verified: evaluation and lifecycle
  tests use cloned/transient overlays, Character Sheet serialization restores
  personal settings, Party Tracker serialization preserves workspace settings, and
  no destructive rewrite/delete path was added.
- [ ] Required deterministic coverage and store parity — FAILED: tests cover the
  evaluator, local composition, stale ordering, failed teardown, and one stale create
  in each store. They do not cover destination-policy preparation for local copy,
  clone, attach, and move; reconnect after failed rule replacement; malformed
  allowed-key evaluator outputs; or full memory/PostgreSQL parity for patch,
  missing/detached basis, and protocol failures. The untested cloud-copy path fails
  in the real stack.
- [ ] Required mutation evidence — FAILED: the evaluator and authority mutants run
  and die, but `character-rules-teardown-disabled` mutates only the returned value of
  `getClearedCampaignRulesState()` and is checked by the evaluator probe; it does not
  mutate the Character Sheet refresh/replacement path. The server mutants similarly
  exercise the shared authority helper rather than independently disabling the
  memory and PostgreSQL transaction fences. No mutant proves rejection of malformed
  allowed-key decisions.
- [ ] Full validation — FAILED: focused Hub, mutations, full unit, ESLint,
  Stylelint, Sass, service-worker/build, audit, SBOM, secrets, and runtime-role
  PostgreSQL gates pass. `npm run test:data` fails LinkCheck, and
  `npm run test:hub:e2e:stack` fails two Chromium tests, including reproducible
  `RULES_VERSION_INVALID` Character Sheet initialization errors.
- [ ] Independent exact-head Inspector pass — FAILED: this exact-head review found
  blocking real-stack, recovery, evidence, and delivery gaps.
- [ ] Draft PR/remote/CI/final handoff — FAILED:
  `gh pr list --head truemichato-campaign-rules-implementation --state all` returns
  `[]`, `git ls-remote --heads origin truemichato-campaign-rules-implementation`
  returns no branch, and the local branch has no upstream. There is no draft PR,
  terminal CI, or final ancestry/diff/rule/evidence/collision/remote handoff.

## Quality Gate

- `npm run test:hub` — PASS: 94 suites passed, 4 skipped; 1,246 tests
  passed.
- `npm run test:hub:mutations` — PASS as written: 7/7 active-context
  mutants, 14/14 campaign-policy mutants, and both additional authority mutants
  were killed; the required path-specific evidence gaps above remain.
- `npm run test:unit` — PASS: 678 suites passed, 6 skipped; 17,802 tests
  passed.
- `npm run test:js` — PASS.
- `npm run test:css:lint` — PASS.
- `npx sass scss/dmscreen.scss css/dmscreen.css` — PASS in a disposable
  exact-HEAD worktree.
- `npm run build:sw` — PASS in the disposable exact-HEAD worktree.
- `npm run build` — PASS in the disposable exact-HEAD worktree.
- `npm run test:data` — **FAIL**: LinkCheck still reports unresolved links,
  including `data/bestiary/monstergroups.json` and `data/crafting.json`.
- `npm run test:hub:e2e:stack` — **FAIL**: all 4 runtime-role PostgreSQL
  suites passed (25 tests), then Chromium finished 21 passed/2 failed. The failures
  were `private-v1-character-campaigns.spec.ts` (240-second timeout) and
  `private-v1.spec.ts` (cloud-copy navigation timeout); browser logs contain repeated
  schema-v2 Character Sheet initialization failures with
  `HubApiError: RULES_VERSION_INVALID`.
- `npm audit --omit=dev --audit-level=high` — PASS: 0 vulnerabilities.
- `npm run hub:check-secrets` — PASS.
- `npm sbom --omit=dev --sbom-format=cyclonedx` — PASS.

## Issues Found

1. **Current-client local-to-campaign copy is broken by the mandatory fence.**
   `CharacterSheetCampaignPanel._pCopyLocalCharacter()` sends
   `this._page._state.toJson()` directly. Local state correctly carries a detached
   basis, but a destination with active schema-v2 rules now requires a campaign basis
   pinned to that destination's active rules id. The exact-head Chromium lifecycle
   times out after clicking “Create cloud copy.” Prepare/evaluate the destination
   context and stamp/recompute the outgoing transient document without mutating the
   local original; cover copy, clone, attach, and move.
2. **Evaluator decisions are not structurally validated.** Both
   `getCampaignSettingsOverlay()` and the wrapped helper accept an allowed-key
   `compliant` decision missing most required contract members. Validate required
   keys, exact field types/values, policy identity, bounded applied rules/errors, and
   effective settings before any overlay is exposed, and use the identity-checking
   path during realtime replacement.
3. **Transient realtime failure has no recovery path.** Failed refresh correctly
   prevents stale-context resurrection, but clearing `_hubContext` permanently makes
   `_pRefreshHubRules()` reject later replay/reconnect events. Add an explicit
   fail-closed state that can be refreshed, or re-resolve the pinned campaign on
   reconnect, and prove failure followed by recovery.
4. **Required behavioral and mutation evidence remains too shallow.** Add common
   memory/PostgreSQL cases for create and patch fencing, detached/missing/stale pins,
   protocol failures, no partial writes, destination preparation, and active-policy
   projections. Mutate the actual Character Sheet replacement/teardown code and each
   store fence, rather than only shared helper return values.
5. **Mandatory full gates are red.** Resolve the real-stack regression and the
   required data gate without misclassifying either as an environment block.
6. **Delivery has not occurred.** Push the one branch, open exactly one draft PR
   against `multiplayer-hub`, await terminal CI, and provide the requested final
   handoff.
7. **Iteration commit discipline was not followed.** Iteration 2 contains five
   Builder commits (`d05b1b71`, `7b2fe468`, `a4102125`, `8d928f71`, and
   `03f76e03`) instead of the required single Builder commit. History is linear and
   must not be rewritten; use normal follow-up commits only.

## What Must Be Fixed

- Prepare and pin destination policy context for copy/clone/attach/move without
  mutating the personal local document, then prove those flows on the real stack.
- Fully validate evaluator decision outputs and reject malformed allowed-key objects.
- Make failed realtime replacement recover correctly after reconnect without stale
  or local-rule operation in the interim.
- Add the missing path-specific lifecycle, store-parity, and mutation evidence.
- Make `test:data` and the full production-derived real-stack gate pass.
- Push the branch, open the sole draft PR, await terminal CI, and record the complete
  clean-state handoff.
