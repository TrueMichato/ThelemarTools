# Inspector Feedback — Iteration 4

## Verdict: FAIL

Iteration 4 fixes several concrete iteration-3 defects. Ordinary grapples no
longer activate the restraint layer, Chain Control is contingent on a successful
grapple and validates the declared 10-foot direction/distance, failed
movement-budget validation no longer commits the doubled pool, Play Mode no
longer calls the nonexistent `_consumeActionType`, production target submission
now calls `applyTargetEffect`, the restraint documentation uses Constitution,
and fresh isolated one-worker normal and `RUN_MEGA=1` runs both pass.

The goal is still incomplete. Combat and Play Mode maintain separate bonus-action
ledgers, so either surface can spend a bonus action without the other noticing.
The state movement API can also erase an already-spent bonus action when it
initializes a new movement round. The canonical target metadata contract remains
bypassable by contradicting `effect` and `targetEffect.effect`. The comprehensive
E2E deliberately selects **Skip** in the real rider picker, then calls the private
target modal and most lifecycle branches through direct state methods. Mobile
target modals still place their footer below the viewport without a scrollable
container, keep the two footer buttons side by side, and restore focus to
`BODY`. Documentation claims the opposite behavior.

## Acceptance Criteria Check

- [ ] **All canonical level 3, 6, 10, and 14 Chained Fury values and mechanics match the TGTT data.** — **FAILED.** Damage dice, range, force/magical damage, chain count, size scaling, Constitution-based restraint DC, recurring damage, 10-foot Chain Control, and level-14 movement/attack values match `TravelersGuidetoThelemar.json`. The bonus-action doubled-movement mechanic is still inconsistent across the Combat, Play Mode, and state ledgers.
- [x] **Spectral Chains is a real feature-granted attack and requires Rage plus Manifest Chains.** — verified by the focused Jest suite, source checks, and fresh browser state. Ending either state removes the attack/targets.
- [x] **A hit can select/create a lightweight target and resolve target-only, Grapple, or Shove.** — the production on-hit path exposes these choices, and browser submission through the target modal created an ordinary grapple through `applyTargetEffect`.
- [x] **Initial grapple/escape and Chain Imprisonment use distinct save contracts.** — focused tests verify Strength/Dexterity against the current grapple-method DC and Chain Imprisonment's separate Strength save against `8 + PB + CON`.
- [x] **Target size, range, capacity, and same-target update behavior are validated.** — state guards and focused tests cover size/range/capacity, while persisted IDs/upsert behavior preserve a selected target rather than duplicating it.
- [x] **Target state persists with stable IDs and recalculates derived values.** — focused persistence/reconciliation tests pass; current range, DCs, size legality, capacity, recurring damage, and effect layers are rebuilt from current character state.
- [x] **Restrained recurring damage equals current Barbarian level with duplicate protection and repeat override.** — verified by focused tests and the fresh one-worker lifecycle run.
- [ ] **Movement is declared, range-checked, size-adjusted, level-14-correct, distributable, transactional, and consumes one bonus action.** — **FAILED.** Successful distribution and failed movement-budget rollback work, but action economy is not shared. In a live browser, `combat._consumeActionType("bonus")` produced `combatAvailable: false` while `state.isActionTypeAvailable("bonus")` remained `true`; consuming through state produced the inverse. A direct state probe also spent the shared bonus action, then successfully doubled movement because `moveChainedTarget` treated `chainedMovementUsage.round === null` as a new round, called `resetActionEconomy()`, and erased the prior spend.
- [x] **Chain Control applies only after a successful grapple and validates a coherent 10-foot declaration.** — focused tests reject resisted control and contradictory/out-of-range declarations; toward/away/lateral final-distance rules now agree with the declared 10-foot shove.
- [x] **All required teardown paths atomically clear active chain effects and occupancy.** — deactivation, rest/reset, out-of-range release, source/level/size/capacity reconciliation, escape, and manual release retain the previously verified teardown behavior.
- [x] **Level 14 grants three attacks only for an all-Spectral-Chains Attack action.** — focused mixed/all-chain allowance tests pass.
- [ ] **The target-aware path is generic and opt-in without regressing unrelated behavior.** — **FAILED.** Production modal submission now correctly calls `applyTargetEffect`, but the generic path still synthesizes target-only metadata with hardcoded source `"chained-fury"`, uses Chained Fury range/copy/error text for every source, and accepts contradictory canonical metadata. A direct call with `targetEffect.effect: "control-shove"` plus top-level `effect: "grapple"` succeeded as an ordinary grapple instead of returning a metadata mismatch.
- [ ] **Combat and Play Mode expose a complete, coherent Chained Targets surface.** — **FAILED.** Both surfaces show target state/actions and capacity warnings, and Play Mode doubled movement no longer throws. However, their bonus-action state disagrees, so a spent bonus action can appear available and be spent again after switching surfaces.
- [ ] **Custom flows meet modal, focus, ARIA, mobile sizing/layout, safe-area, and theme requirements.** — **FAILED.** At 390×844, target-card controls are full-width and 44 px high, and initial target focus lands correctly. The target modal itself measured 805 px tall inside a 614 px non-scrollable modal; its action row began at y=1018 below the 844 px viewport. The footer computed as `display:flex` with two 176 px side-by-side buttons despite the intended grid rule. Cancelling restored focus to `BODY`, not a connected player control.
- [x] **Builder, LevelUp, and QuickBuild ingest the subclass without a new picker.** — Builder/LevelUp tests pass. `npm run spawn -- "barbarian/chained fury/3/minotaur" --strict` exited 0 and produced Barbarian 3 / Path of the Chained Fury with no unresolved choices or unhandled prompts.
- [ ] **Targeted Jest verifies calculations, transitions, persistence, teardown, movement/action economy, and progression at the real gates.** — **FAILED.** The focused suite passes 788 tests and adds useful regressions for rider/effect mismatch, ordinary grapple metadata, failed doubled movement, and Chain Control. It still has no regression for Combat↔Play Mode action-economy synchronization, new-round bonus-action erasure, `effect` versus `targetEffect.effect`, target-modal focus/layout, or actual Play Mode interaction.
- [ ] **The Chained Fury E2E drives the actual Spectral Chains attack and complete target lifecycle.** — **FAILED.** `rollSpectralChainsTargetEffect` rolls the real attack and confirms Hit, but then explicitly selects `Skip` in the real on-hit picker and invokes private `_pOfferTargetEffect` from `page.evaluate`. `probeChainedFuryLifecycleBranches` performs target-only, resisted saves, recurring damage, movement, out-of-range release, and Rage teardown by calling state APIs directly. It does not exercise those required branches through Combat/Play Mode controls, including the shared action-economy behavior that remains broken.
- [x] **Focused Jest, focused Playwright, and `RUN_MEGA=1` matrix coverage pass without unexplained skips.** — verified on fresh isolated ports with one worker: normal 6 passed / 2 expected MEGA skips; `RUN_MEGA=1` 8 passed. Initial default-port runs reused a server from another worktree and failed; the fresh-port reruns are the valid results.
- [ ] **Relevant subsystem, toggle, limitations, and E2E documentation is accurate.** — **FAILED.** The restraint formula is corrected to Constitution. However, `docs/e2e/test-suite-catalog.md` says the lifecycle does not bypass the attack/modal pipeline with direct state mutation, while the implementation does exactly that. `10-known-limitations.md` also claims stacked modal footers and minimum bottom clearance that browser measurement disproves.

## Previous Feedback Verification

1. **Deterministic one-worker E2E:** the current source passes both required
   runs on fresh ports. The first default-port attempts reused an existing
   server whose cwd was another worktree, so those failures were discarded.
2. **Play Mode runtime crash:** fixed; a real Play Mode doubled move succeeded,
   spent the state bonus action, updated the target, and rendered the Bonus slot
   as used.
3. **Failed doubled-movement mutation:** fixed for movement-budget failure; the
   new Jest regression leaves the movement pool and bonus action unchanged.
4. **Chain Control:** fixed for successful-grapple gating and coherent scalar
   direction/final-distance validation.
5. **Ordinary-grapple restraint metadata:** fixed; both compatibility booleans
   and `effects.restraint.active` remain false with no recurring damage.
6. **Rider/effect mismatch:** fixed only for `riderId` versus top-level
   `effect`; nested `targetEffect.effect` can still contradict and be ignored.
7. **Generic dispatch:** partially fixed; production submission reaches
   `applyTargetEffect`, but source-neutral target-only metadata/UI is not
   complete.
8. **Mobile/accessibility:** target cards and fields improved, but footer
   stacking, viewport-safe scrolling/clearance, and focus restoration remain
   broken.
9. **Regression coverage:** state-level coverage expanded, but the previous
   Play Mode and accessibility runtime failures are still not protected by
   tests.
10. **Documentation:** restraint DC fixed; E2E and mobile claims remain
    inaccurate.

## Independent Runtime Evidence

1. **Split action economy:** after starting combat and calling
   `combat._consumeActionType("bonus")`, Combat reported the bonus action used
   while the state/Play Mode API reported it available. Consuming through the
   state API produced the opposite result: Combat still reported available.
2. **New-round reset bypass:** after `state.consumeActionType("bonus")`, a first
   doubled movement with `chainedMovementUsage.round === null` succeeded because
   `moveChainedTarget` reset action economy before consuming.
3. **Metadata contract bypass:** `{source: "chained-fury",
   targetEffect: {effect: "control-shove"}, effect: "grapple"}` succeeded as a
   grapple instead of being rejected.
4. **Generic production dispatch:** a browser spy confirmed target-modal Apply
   invokes `state.applyTargetEffect` with source, rider, target metadata, and
   save fields; the created ordinary grapple had no restraint layer.
5. **Play Mode successful doubled movement:** moving the live target from 15 to
   20 feet consumed 10 feet after drag adjustment, established an 80-foot
   doubled pool, and marked the state-backed Bonus slot used without throwing.
6. **Mobile modal:** at 390×844, the modal bottom was y=844, but the form bottom
   was y=1094 and the footer began at y=1018. The modal had no vertical
   scrolling; footer buttons remained side by side.
7. **Focus:** target name received initial focus, but cancelling the target
   modal left `document.activeElement` as `BODY`.

## Quality Gate

- Command: `npm run test:unit -- CharacterSheetChainedFury CharacterSheetTargetEffects CharacterSheetCombat CharacterSheetToggleAbilities --no-coverage --forceExit`
  - Result: **PASS**
  - Details: 26 suites, 788 tests passed.
- Command: focused ESLint on the changed Character Sheet and target-effect Jest files
  - Result: **PASS**
- Command: `npm run test:css`
  - Result: **PASS**
- Command: strict Quick Build spawn for `barbarian/chained fury/3/minotaur`
  - Result: **PASS**
  - Details: exit 0; Barbarian 3 / Path of the Chained Fury, Minotaur, no unresolved choices or unhandled prompts.
- Command: `PW_PORT=8765 npx playwright test test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts --reporter=list --workers=1`
  - Result: **PASS**
  - Details: 6 passed, 2 expected MEGA skips.
- Command: `PW_PORT=8766 RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts --reporter=list --workers=1`
  - Result: **PASS**
  - Details: all 8 tests passed, including both MEGA walks.
- Command: `npm run test:js`
  - Result: **FAIL (pre-existing unrelated baseline)**
  - Details: the same 14 errors in unchanged bestiary quick-action files and `CharacterSheetNpcExporter.attachmentCorpus.test.js`.
- Command: `npm test`
  - Result: **FAIL (same pre-existing unrelated baseline)**
  - Details: stopped at the same JavaScript lint failures.

## Issues Found

1. Combat and Play Mode do not share one action-economy source of truth.
2. New-round movement initialization can erase an already-spent bonus action.
3. The target metadata contract does not reject conflicts between top-level
   `effect` and nested `targetEffect.effect`.
4. The target-aware flow still has Chained-Fury-specific source/range/copy in
   nominally generic code.
5. The E2E skips the real rider selection and directly invokes private/state
   methods for the required lifecycle branches.
6. Mobile target modal actions remain below the viewport, side by side, and
   without a usable scrolling/safe-area solution.
7. Target-modal cancellation still fails focus restoration.
8. Regression tests and documentation overstate the behavior above.

## What Must Be Fixed

1. Make Combat and Play Mode consult and mutate one action-economy API for bonus
   actions; add bidirectional regression tests.
2. Never reset action economy inside a movement request. Initialize movement
   accounting independently and reject doubling whenever the shared bonus
   action is already spent.
3. Normalize and validate one canonical metadata object, rejecting disagreement
   among `source`, `targetEffect.source`, `effect`, and
   `targetEffect.effect`.
4. Remove hardcoded Chained Fury source/range/copy from the generic target
   dispatcher, or move those details into source-owned metadata/handlers.
5. Rewrite the E2E to select the real on-hit option and drive target-only,
   save-success/failure, Chain Control, movement/doubling, recurring damage,
   Escape/Release, Play Mode, persistence, and teardown through player-facing
   controls rather than direct private/state calls.
6. Make the modal body vertically scrollable within the viewport, force the
   footer to a true one-column layout despite flex utility specificity, reserve
   reachable safe-area clearance, and restore focus to a connected control.
7. Add regressions for the browser/runtime failures and correct the E2E catalog
   and limitations documentation to match verified behavior.
