# Inspector Feedback — Iteration 2

## Verdict: FAIL

Iteration 2 adds a substantial target model and usable Combat/Play Mode surfaces, but the implementation still does not satisfy the immutable goal. Independent state probes found incorrect source and activation gating, missing target-only application, incomplete derived-state reconciliation, incorrect out-of-range behavior, incomplete doubled-movement accounting, and incorrect Chain Control final-position handling. The new E2E lifecycle probe also failed when rerun in isolation after reaching the target interaction.

## Acceptance Criteria Check

- [ ] **TGTT Chained Fury is available through Quick Build, the normal Builder, and Level Up at Barbarian 3, and is gated by subclass/source.** — **FAILED.** The normal Builder/Level Up E2E milestones pass, and `_getSubclassForClass` finds the Quick Build subclass, but the Quick Build test does not execute `_applyQuickBuild` or verify the resulting character/picker behavior. More importantly, the runtime gates only on the normalized subclass name: a Barbarian subclass named `Chained Fury` with source `OTHER` receives `hasManifestChains` and Spectral Chains.
- [ ] **Level 3 Manifest Chains mechanics and target choice work correctly.** — **FAILED.** The normal Rage → Manifest Chains path, weapon profile, reach, finesse handling, Rage damage, grapple/shove options, and size rules are covered by passing focused tests. However, Spectral Chains only declares `requiresState: "manifestChains"`. A malformed/restored state with Manifest Chains active and Rage inactive still exposes the weapon, and Play Mode can create this state by toggling Rage off through `toggleActiveState`. There is also no target-only/no-rider player flow.
- [ ] **Level 6 Chain Imprisonment mechanics work correctly.** — **FAILED.** The initial save DC and recurring damage values are correct, but the reusable state API accepts `effect: "restrain"` below level 6 when the save is omitted, creating an invalid restrained target with no restraint DC. Existing restrained targets retain stale recurring damage after Barbarian level changes.
- [ ] **Level 10 Chain Control works from attack resolution with a legal declared final position.** — **FAILED.** The implementation always calculates `current distance + 10`; the modal has no final-distance or direction input. This rejects legal inward/lateral shoves near maximum reach and does not validate the player's declared final position.
- [x] **Level 14 Unchained Fury provides four chains, unrestricted grapple size, free movement while grappling, and three attacks while manifested.** — verified by focused calculation tests and the generic mixed/all-chain attack-allowance tests. The Level 14 feature values themselves are correct. Lifecycle failures after later level loss are recorded under persistence/recalculation below.
- [ ] **On-hit handling supports rider choice or no rider, target identity, saves, success/failure, and lightweight target state.** — **FAILED.** Grapple/restrain modal fields exist and save outcomes can be entered, but choosing `Skip` exits before target selection. There is no player-facing way to persist a selected target with no rider. The invalid low-level restrain state noted above is also possible through the shared API.
- [ ] **Chain occupancy, movement, action economy, escape, recurring damage, release, and out-of-range teardown are correct.** — **FAILED.** Release, escape, recurring-damage actions, and basic occupancy exist. However:
  - `moveChainedTarget` rejects an out-of-range move while retaining the grapple/restraint/occupied chain instead of tearing it down.
  - Load reconciliation clamps an out-of-range target to current reach instead of removing the effect.
  - After spending a bonus action to double movement, later chained-target moves use the normal-speed ceiling; requesting doubled movement again is rejected because the bonus action is already spent. The doubled pool therefore cannot be distributed across multiple target moves.
  - Play Mode exposes no doubled-movement option or integrated bonus-action feedback.
- [ ] **A usable, responsive, accessible target surface exists in Combat and Play Mode.** — **FAILED.** Both surfaces show target name, size, condition, distance, occupancy/reach, and lifecycle actions, and their primary target buttons measured 44 px high on a 390×844 viewport. Remaining failures include:
  - the Combat distance field stays approximately 80 px wide on mobile because its inline width overrides the responsive rule;
  - modal footer actions remain side-by-side on mobile rather than stacking;
  - Play Mode's Escape modal leaves focus on `BODY` and has no close callback to restore focus to its trigger;
  - the UI provides summaries but not explicit capacity/range warning states.
- [ ] **Target state persists, recalculates from current character state, and tears down when invalid.** — **FAILED.** Basic save/load persistence works, but reconciliation is incomplete:
  - recurring restraint damage is not updated when Barbarian level changes;
  - target size legality is not revalidated;
  - occupied targets are not reduced to current chain capacity (four targets remain after dropping from Level 14 to Level 10, whose capacity is two);
  - out-of-range targets are clamped rather than released;
  - a non-TGTT same-name subclass retains the mechanics;
  - Play Mode Rage deactivation does not cascade Manifest Chains off. Target reads eventually clear targets, but Manifest Chains and Spectral Chains remain active.
- [x] **Attack resolution and attack-count integration preserve ordinary attacks and correctly handle mixed/all-chain turns.** — verified by focused Jest coverage for the generic allowance path, including mixed-action and all-chain cases. Manual desktop interaction also confirmed the actual Spectral Chains attack can reach the hit and rider prompts.
- [ ] **The target-effect architecture is reusable rather than coupled to one attack ID.** — **FAILED.** Dispatching persisted effects by `targetEffect.source` instead of an attack-ID prefix is an improvement. The interaction and state lifecycle still rely on Chained-Fury-specific methods such as `_pOfferChainedTargetEffect`, `applyChainedTargetEffect`, `moveChainedTarget`, and `attemptChainedTargetEscape`; another target-effect source would require new feature-specific plumbing.
- [ ] **Automated tests are comprehensive and prove the real lifecycle and regression behavior.** — **FAILED.** The new helper uses the real attack/modal entry point, but its lifecycle assertion only creates one restrained target and releases it through a direct page-object state call. It does not cover no-rider selection, save success/failure, grapple, shove, declared Chain Control position, movement, doubled movement/bonus action, recurring damage/override, Escape UI, persistence, Play Mode, Rage/Manifest teardown, source removal, level-down reconciliation, or out-of-range teardown. The Quick Build test does not execute Quick Build. No committed red/fail-before-fix evidence exists. In addition, an isolated extended-timeout rerun reached Level 11 and then timed out for 600 seconds waiting for `[data-target-name]`, because the expected target modal did not open after the rider selection.
- [x] **Documentation explains the TGTT mechanics and no help-only entry grants gameplay effects.** — verified in the changed documentation and feature-calculation paths. The mechanics are attached through subclass state rather than help-text parsing.

## Previous Feedback Verification

Every issue from iteration 1 was rechecked:

- **Incomplete per-level mechanic model:** partially fixed; core scalar values and options are now present, but source gating, invalid restrain states, and declared Chain Control positioning remain wrong.
- **Missing target lifecycle:** partially fixed; persisted targets, saves, recurring damage, Escape, Move, Repeat, and Release exist, but target-only selection, out-of-range teardown, and level/source reconciliation remain incomplete.
- **Action economy/movement:** partially fixed; action and bonus-action flags exist, but doubled movement cannot be spent correctly across multiple moves and is absent from Play Mode.
- **Teardown/recalculation:** not fixed completely; stale recurring damage, excess occupancy, illegal size/range, and Play Mode Rage deactivation remain.
- **Attack gating/counting:** mixed/all-chain counting is fixed; visibility still does not independently require both Rage and Manifest Chains.
- **Responsive/accessibility UI:** improved but not fixed; touch heights are acceptable, while mobile field/footer layout and Play Mode modal focus remain deficient.
- **Real E2E coverage:** improved from direct state application to the real attack entry point, but remains shallow and is currently unstable/red at the target modal.
- **Documentation:** fixed.

## Independent Runtime Evidence

The following behaviors were reproduced directly against `CharacterSheetState` rather than inferred from Builder tests:

1. A same-name subclass with source `OTHER` receives Manifest Chains and Spectral Chains.
2. Manifest Chains active without Rage still exposes Spectral Chains.
3. Turning Rage off in Play Mode leaves Manifest Chains active because it calls `toggleActiveState`, not the dependent-state teardown path.
4. An L3 direct restraint application can create a restrained target without Chain Imprisonment.
5. A restrained L10 target retains recurring damage 10 after loading at Level 6.
6. Four occupied targets survive a Level 14 → Level 10 reduction to a two-chain capacity.
7. An out-of-range move is rejected without releasing the target.
8. An out-of-range saved target is clamped to reach and keeps its stale effect.
9. Doubled movement works for the first target move but cannot be used for subsequent moves from the same doubled pool.

## Visual Verification

- **Desktop:** exercised the production Combat-tab Spectral Chains attack, Hit prompt, Chain Imprisonment selection, target/save form, and rendered target card. The card displayed target name, size, restrained state, distance, occupancy/reach, Move, damage, Repeat, Escape, and Release.
- **Mobile (390×844):** inspected Combat and Play Mode target cards and modals. Target action buttons were 44 px high and Play Mode used a single-column target-action grid. The narrow Combat distance input, unstacked modal footer, missing Play Mode doubled-movement control, and missing Play Mode Escape-modal focus placement/restoration remain.

## Quality Gate

- Focused Chained Fury/Character Sheet Jest: **PASS** — 26 suites, 779 tests.
- Focused ESLint on all changed JavaScript/Jest files: **PASS**.
- CSS lint/check: **PASS**.
- Focused Chained Fury Playwright (default gates): **PASS once** — 6 passed, 2 expected MEGA skips.
- Chained Fury Playwright with `RUN_MEGA=1`: **FAIL** — 7 passed, 1 failed in `beforeEach` while waiting for `charSheet`; this run was affected by concurrent load.
- Isolated Chained Fury USE rerun, one worker, extended initialization timeout: **FAIL** — reached Level 11, then timed out after 600 seconds waiting for the target modal's `[data-target-name]` field.
- Full unit suite (`npm run test:unit`): **FAIL** — 584 suites/16,459 tests passed; one unrelated `CraftingDataFreshness` suite failed because six required offline cache files were absent.
- Full JavaScript lint / `npm test`: **FAIL** — the same 14 pre-existing errors in unchanged bestiary files and `CharacterSheetNpcExporter.attachmentCorpus.test.js`.
- `git diff --check 4a84b403..HEAD`: only reports a blank line at EOF in immutable `goal.md`; the goal was not modified.

The broader suite failures caused by missing caches and unchanged lint debt are environmental/baseline issues, not attributed to this Builder. They do not alter the product-level FAIL established by the independent lifecycle probes and the red isolated E2E interaction.

## Issues Found

1. Subclass mechanics are name-gated but not TGTT-source-gated.
2. Spectral Chains does not independently require both Rage and Manifest Chains, and Play Mode bypasses dependent-state deactivation.
3. No no-rider/target-only application path exists.
4. The shared state API permits an invalid pre-Level-6 restrained target.
5. Reconciliation leaves stale recurring damage, illegal target sizes, excess chain occupancy, and out-of-range effects.
6. Out-of-range movement rejects the request instead of ending the chain effect.
7. Doubled movement is modeled per call rather than as a persistent per-turn movement pool and is missing from Play Mode.
8. Chain Control assumes an outward 10-foot shove instead of accepting and validating a declared final position.
9. Target-effect plumbing remains feature-specific.
10. Mobile/accessibility behavior remains incomplete.
11. Quick Build and lifecycle E2E coverage are not deep enough, and the isolated real interaction currently fails.

## What Must Be Fixed

1. Gate all Chained Fury calculations, state restoration, and granted attacks on the canonical TGTT subclass/source identity; require both active Rage and Manifest Chains for Spectral Chains and its attack allowance.
2. Make Play Mode use the same activation/deactivation service as Combat/Overview so Rage teardown cascades to Manifest Chains and target effects.
3. Add a real target-only/no-rider branch after hit confirmation.
4. Validate effect availability, level, saves, target size, capacity, and range inside the shared state mutation API, not only in modal option visibility.
5. Reconcile all derived target state on load and character changes: save DCs, recurring damage, size legality, reach, source validity, and chain capacity. Release effects that become invalid rather than clamping them.
6. End the relevant grapple/restraint and free the chain when a target leaves range.
7. Track a doubled per-turn movement allowance that can be spent across multiple target moves, consume the bonus action once, and expose the same control/status in Play Mode.
8. Let Chain Control collect a declared final distance/direction and validate that final position against current reach.
9. Extract a genuinely generic target-effect lifecycle/renderer contract so a second source does not require another feature-specific modal and state API.
10. Fix mobile input/footer layout and modal focus placement/restoration; add explicit warning/status feedback for range and capacity failures.
11. Expand Jest and Playwright coverage for all required branches, run actual Quick Build, use both Combat and Play Mode controls, and make the real lifecycle probe deterministic and green.

