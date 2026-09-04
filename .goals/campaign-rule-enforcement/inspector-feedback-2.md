# Inspector Feedback — Iteration 2

## Verdict: FAIL

## Acceptance Criteria Check

- [x] Linear ancestry and migration boundary — verified: `HEAD` is
  `03f76e03d78b60b2af0158c4cb2e133e009e8816`; its merge-base with
  `29eaf1087e3b59ff5184edf8337da340396515c8` is exactly that baseline,
  `git merge-base --is-ancestor` succeeds, and the baseline-to-HEAD diff contains
  no migration path.
- [x] Shared closed evaluator — verified: the browser/server data-only evaluator
  rejects unknown envelope keys, non-integer rule identities, unsupported schema
  and catalog versions, missing capabilities, incompatible protocol versions, stale
  policy pins, unsupported surfaces, and invalid rule combinations with stable
  error codes. Schema-v1 and explicit-local adapters pass focused tests, and all
  evaluator mutants are killed.
- [ ] Truthful Enforced catalog surfaces — FAILED: the catalog now truthfully
  downgrades `tgtt.enabled` to Advisory and retains the three content-gating rules
  as Planned, but the two remaining Enforced carry rules are not end-to-end usable
  on all claimed projections. PostgreSQL character projection supplies an incomplete
  rules-version envelope and rejects active campaign characters with
  `RULES_VERSION_INVALID`.
- [ ] Composition and lifecycle replacement — FAILED: personal-setting composition,
  serialization stripping, normal teardown, failed-refresh teardown, replacement,
  and stale-order tests pass. However, failed realtime refresh calls
  `_clearHubRules()`, which nulls `_hubContext`; every later refresh then returns at
  the `!this._hubContext` guard. There is no tested reconnect recovery or explicit
  blocked state, so a transient fetch failure cannot recompute rules without a
  reload.
- [ ] Character Sheet runtime/builder behavior — FAILED: the TGTT master toggle now
  consistently gates the inspected carry, jumping, Linguistics, reading, critical
  roll, and PDF paths, and local unit tests pass. The production-derived stack still
  logs `Failed to initialize character sheet: HubApiError:
  RULES_VERSION_INVALID` for schema-v2 campaign characters, so cloud Character Sheet
  runtime is broken.
- [ ] DM/party projection parity — FAILED: focused Party Tracker tests prove transient
  schema-v1/v2 composition and master-toggle behavior, but PostgreSQL projections
  share the broken carry-basis context path. Thus campaign character projections
  consumed by DM/party surfaces are not proven usable on the real stack.
- [x] Authoritative atomic server fencing — verified: request protocol is passed into
  both stores; active schema-v2 carry writes require a campaign basis with the exact
  active immutable rules id and protocol 4. Direct, memory, and PostgreSQL stale
  create probes reject before a write, and the relevant authority mutants are killed.
- [ ] Protocol-4/legacy compatibility — FAILED: focused schema-v1, no-carry legacy,
  protocol-3 rejection, and protocol-4 tests pass, but existing real-stack character
  workflows regress under the new strict envelope and fail with
  `RULES_VERSION_INVALID`. Compatibility is therefore not end-to-end.
- [x] Non-destructive documents/serialization — verified: evaluation and lifecycle
  tests use cloned/transient overlays, Character Sheet serialization restores
  personal settings, Party Tracker serialization preserves workspace settings, and
  no destructive rewrite/delete path was added.
- [ ] Required deterministic coverage and store parity — FAILED: tests cover the
  evaluator, local composition, stale ordering, failed teardown, and one stale create
  in each store. They do not cover PostgreSQL `pGetCharacter`/carry-basis projection
  with an active schema-v2 policy, reconnect after failed rule replacement, or full
  memory/PostgreSQL parity for patch, missing/detached basis, and protocol failures.
  The untested projection path is failing in the real stack.
- [ ] Required mutation evidence — FAILED: the evaluator and authority mutants run
  and die, but `character-rules-teardown-disabled` mutates only the returned value of
  `getClearedCampaignRulesState()` and is checked by the evaluator probe; it does not
  mutate the Character Sheet refresh/replacement path. The server mutants similarly
  exercise the shared authority helper rather than independently disabling the
  memory and PostgreSQL transaction fences.
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

1. **PostgreSQL active-policy character projection is broken.**
   `_pGetCarryBasisContext()` selects only `r.id` and `r.rules` and returns
   `{id, rules}`. `getExpectedCarryBasis()` now sends that object through the closed
   evaluator, which requires finite `version`, `schemaVersion`, and `catalogVersion`.
   A direct exact-head probe of that same object returns
   `RULES_VERSION_INVALID`, matching the production Chromium logs. Select and
   normalize the complete rules identity in this path and add a real PostgreSQL
   projection test.
2. **Transient realtime failure has no recovery path.** Failed refresh correctly
   prevents stale-context resurrection, but clearing `_hubContext` permanently makes
   `_pRefreshHubRules()` reject later replay/reconnect events. Add an explicit
   fail-closed state that can be refreshed, or re-resolve the pinned campaign on
   reconnect, and prove failure followed by recovery.
3. **Required behavioral and mutation evidence remains too shallow.** Add common
   memory/PostgreSQL cases for create and patch fencing, detached/missing/stale pins,
   protocol failures, no partial writes, and active-policy projections. Mutate the
   actual Character Sheet replacement/teardown code and each store fence, rather than
   only shared helper return values.
4. **Mandatory full gates are red.** Resolve the real-stack regression and the
   required data gate without misclassifying either as an environment block.
5. **Delivery has not occurred.** Push the one branch, open exactly one draft PR
   against `multiplayer-hub`, await terminal CI, and provide the requested final
   handoff.
6. **Iteration commit discipline was not followed.** Iteration 2 contains five
   Builder commits (`d05b1b71`, `7b2fe468`, `a4102125`, `8d928f71`, and
   `03f76e03`) instead of the required single Builder commit. History is linear and
   must not be rewritten; use normal follow-up commits only.

## What Must Be Fixed

- Supply the complete normalized schema-v2 identity from PostgreSQL carry-basis
  context and prove campaign Character Sheet/DM projections on the real stack.
- Make failed realtime replacement recover correctly after reconnect without stale
  or local-rule operation in the interim.
- Add the missing path-specific lifecycle, store-parity, and mutation evidence.
- Make `test:data` and the full production-derived real-stack gate pass.
- Push the branch, open the sole draft PR, await terminal CI, and record the complete
  clean-state handoff.
