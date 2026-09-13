# Inspector Feedback — Iteration 5

## Verdict: FAIL

Iteration 5 fixes most of the state-layer defects from iteration 4. Combat and
state consumers now share the same action-economy ledger, a movement request no
longer resets that ledger when its movement round is initialized, conflicting
top-level and nested target metadata is rejected, the production attack flow
selects the real rider instead of selecting Skip, and the target modal is now
vertically scrollable on a mobile viewport. Both isolated one-worker Playwright
runs are green.

The goal is still incomplete. Play Mode's per-slot **Restore Bonus** control
calls the all-slots `resetActionEconomy()` operation, restoring Action and
Reaction at the same time and allowing those resources to be reused from
Combat. The mobile footer rule still loses the cascade to the shared
`display:flex !important` utility, so the two modal actions remain side by side
at 390 px. Cancelling the target modal after the real Spectral Chains attack
restores focus to the global Menu button rather than the initiating attack
control. Finally, the E2E still does not exercise Play Mode, Escape, or manual
Release, and two of its claimed lifecycle assertions do not measure the
behavior they name: distributed movement is returned as a literal `true`, and
recurring damage is inferred only from the target still existing after the
buttons were clicked.

## Acceptance Criteria Check

- [x] **All canonical level 3, 6, 10, and 14 Chained Fury values and mechanics match the TGTT data.** — verified against `TravelersGuidetoThelemar.json`, the feature calculations, focused Jest, and the passing level matrix: damage dice/range, force and magical damage, chain count, size scaling, Constitution restraint DC, recurring damage, Chain Control distance, level-14 movement, and all-chain attack allowance match.
- [x] **Spectral Chains is a real feature-granted attack and requires Rage plus Manifest Chains.** — focused tests pass and the browser exposed the attack only with both states activated.
- [x] **A hit can select/create a lightweight target and resolve target-only, Grapple, or Shove.** — the real browser flow reached Hit, the on-hit picker, and the target modal; the E2E now selects real rider entries rather than Skip.
- [x] **Initial grapple/escape and Chain Imprisonment use distinct save contracts.** — focused Jest verifies Strength/Dexterity against the live grapple-method DC and the independent Strength save against `8 + PB + CON`.
- [x] **Target size, range, capacity, and same-target update behavior are validated.** — state guards and focused tests cover these constraints and stable-ID upserts.
- [x] **Target state persists with stable IDs and recalculates derived values.** — focused persistence/reconciliation tests and the E2E round trip pass.
- [x] **Restrained recurring damage equals current Barbarian level with duplicate protection and repeat override.** — focused Jest verifies the state behavior.
- [x] **Movement is declared, range-checked, size-adjusted, level-14-correct, distributable, transactional, and consumes one bonus action.** — focused tests pass, including the iteration-4 new-round bypass regression. A live browser probe confirmed that a pre-spent bonus action rejects doubled movement without mutating the movement pool.
- [x] **Chain Control applies only after a successful grapple and validates a coherent 10-foot declaration.** — focused tests cover resisted control and direction/final-distance validation.
- [x] **All required teardown paths atomically clear active chain effects and occupancy.** — focused teardown/reconciliation tests remain green.
- [x] **Level 14 grants three attacks only for an all-Spectral-Chains Attack action.** — focused mixed/all-chain allowance tests pass.
- [x] **The target-aware path is generic and opt-in without regressing unrelated behavior.** — production dispatch now uses source metadata plus `applyTargetEffect`; a live contradictory nested/top-level metadata probe returned `effect-metadata-mismatch`.
- [ ] **Combat and Play Mode expose a complete, coherent Chained Targets surface.** — **FAILED.** Shared consumption now agrees in both directions, but Play Mode's rendered `Restore Bonus` handler invokes `resetActionEconomy()`. With Action, Bonus, and Reaction all spent, activating only **Restore Bonus** changed the shared state from all unavailable to all available. Combat consequently also sees Action and Reaction restored.
- [ ] **Custom flows meet modal, focus, ARIA, mobile sizing/layout, safe-area, and theme requirements.** — **FAILED.** The target modal is scrollable and its inputs/actions are 44 px high, but at an emulated 390×844 viewport its footer computed to `display:flex`, with two 176 px side-by-side buttons. After a keyboard-focused Spectral Chains attack followed by Hit → Chain Imprisonment → Cancel, focus landed on the global Menu button rather than the originating attack control.
- [x] **Builder, LevelUp, and QuickBuild ingest the subclass without a new picker.** — Builder/LevelUp Playwright coverage passes; strict Quick Build produced Barbarian 3 / Path of the Chained Fury with no unresolved choices or unhandled prompts.
- [ ] **Targeted Jest verifies calculations, transitions, persistence, teardown, movement/action economy, and progression at the real gates.** — **FAILED.** The focused suite passes 790 tests and now covers shared Combat/state consumption plus the new-round movement guard, but it has no regression for Play Mode's per-slot restore behavior or the still-broken modal layout/focus behavior.
- [ ] **The Chained Fury E2E drives the actual Spectral Chains attack and complete target lifecycle.** — **FAILED.** Rider selection and target creation now use the real player-facing attack/modal path, and Combat target-row buttons are clicked. However, `probeChainedFuryLifecycleBranches` never opens Play Mode, never drives Escape or manual Release, returns `distributedMovement: true` unconditionally, and reports `recurringDamage` merely when the restrained target remains present. These are not concrete assertions that movement accounting or duplicate/repeat damage behavior occurred.
- [x] **Focused Jest, focused Playwright, and `RUN_MEGA=1` matrix coverage pass without unexplained skips.** — verified on fresh ports with one worker: normal 6 passed / 2 expected MEGA skips; `RUN_MEGA=1` all 8 passed.
- [ ] **Relevant subsystem, toggle, limitations, and E2E documentation is accurate.** — **FAILED.** The E2E catalog says the lifecycle covers Play Mode/player-facing lifecycle behavior that the implementation does not exercise, and the limitations document claims narrow modal actions stack although computed browser layout remains a two-button flex row.

## Previous Feedback Verification

1. **Shared action economy:** consumption is now shared between Combat, state,
   and Play Mode. The new per-slot restoration regression remains: restoring
   Bonus restores every action slot.
2. **New-round reset bypass:** fixed. Movement initialization no longer calls
   `resetActionEconomy()`, and a pre-spent bonus action rejects doubling without
   mutating movement usage.
3. **Canonical metadata:** fixed for top-level/nested source/effect conflicts
   and rider/effect conflicts.
4. **Generic dispatch:** substantially fixed. The production modal reads
   source metadata and dispatches through `applyTargetEffect`.
5. **Real E2E rider selection:** fixed. The test now selects the requested real
   on-hit option rather than Skip and does not invoke `_pOfferTargetEffect`
   directly.
6. **Complete E2E lifecycle:** not fixed. Play Mode, Escape, and manual Release
   remain absent, while movement and recurring-damage result booleans are not
   based on the effects they claim to assert.
7. **Mobile modal:** scrolling and bottom reachability are fixed, but footer
   stacking is not.
8. **Focus restoration:** not fixed to the initiating control; the observed
   fallback target was the page Menu button.
9. **Documentation:** still overstates mobile and E2E behavior.

## Independent Runtime Evidence

1. **Shared consumption works:** after Combat consumed Bonus, both
   `combat._isActionTypeAvailable("bonus")` and
   `state.isActionTypeAvailable("bonus")` returned false. Consuming through
   state produced the same result in Combat.
2. **Movement transaction works:** after spending Bonus directly, doubled
   movement returned `bonus-action-used`; movement remained undoubled with zero
   feet used and Bonus remained spent.
3. **Metadata conflict is rejected:** a target request with nested
   `control-shove` and top-level `grapple` returned
   `effect-metadata-mismatch`.
4. **Play Mode restores too much:** with Action, Bonus, and Reaction all spent,
   clicking the rendered `Restore Bonus` slot changed the shared state from
   `{action:false, bonus:false, reaction:false}` to all three available.
5. **Mobile footer still does not stack:** at 390×844, the target modal was
   scrollable (`scrollHeight 747`, `clientHeight 590`) and reachable after
   scrolling, but the footer computed as `display:flex`; its two buttons were
   each 176 px wide and remained side by side.
6. **Focus restoration is misplaced:** after the real Spectral Chains attack,
   Hit prompt, real Chain Imprisonment selection, and target-modal Cancel,
   `document.activeElement` was the global Menu button rather than the attack
   control.
7. **E2E assertions are incomplete:** source inspection shows
   `distributedMovement: true` is hardcoded and `recurringDamage` is assigned
   from `retainedRestrainedTarget`, without inspecting movement state, action
   economy, damage results, or duplicate-turn state.

## Quality Gate

- Command: `npm run test:unit -- CharacterSheetChainedFury CharacterSheetTargetEffects CharacterSheetCombat CharacterSheetToggleAbilities --no-coverage --forceExit`
  - Result: **PASS**
  - Details: 26 suites, 790 tests passed.
- Command: focused ESLint on the changed Character Sheet and target-effect Jest files
  - Result: **PASS**
- Command: `npm run test:css`
  - Result: **PASS**
- Command: `npm run spawn -- "barbarian/chained fury/3/minotaur" --strict`
  - Result: **PASS**
  - Details: Barbarian 3 / Path of the Chained Fury, no warnings, unresolved choices, or unhandled prompts.
- Command: `PW_PORT=8875 npx playwright test test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts --reporter=list --workers=1`
  - Result: **PASS**
  - Details: 6 passed, 2 expected MEGA skips.
- Command: `PW_PORT=8876 RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts --reporter=list --workers=1`
  - Result: **PASS**
  - Details: all 8 tests passed.
- Command: `npm run test:js`
  - Result: **FAIL (pre-existing unrelated baseline)**
  - Details: the same 14 errors in unchanged bestiary quick-action files and `CharacterSheetNpcExporter.attachmentCorpus.test.js`.
- Command: `npm test`
  - Result: **FAIL (same pre-existing unrelated baseline)**
  - Details: stopped at the same JavaScript lint failures.

## Issues Found

1. Play Mode's per-slot restore operation resets all shared action-economy
   slots, enabling unrelated actions/reactions to be reused.
2. The mobile modal footer remains a two-column flex row because the new grid
   rule does not win the computed cascade.
3. Target-modal focus restoration falls back to the global Menu button rather
   than the control that initiated the attack flow.
4. The E2E still omits Play Mode, Escape, and manual Release and contains
   non-measuring/hardcoded success flags for movement and recurring damage.
5. Jest coverage and documentation do not catch or accurately describe the
   remaining runtime behavior.

## What Must Be Fixed

1. Add a state API that restores only the requested action type, and make each
   Play Mode slot toggle only itself. Add a regression proving that restoring
   Bonus leaves spent Action and Reaction unavailable in both Play Mode and
   Combat.
2. Make the mobile footer genuinely one column in the computed cascade at
   390 px, not merely in the authored rule. Add a browser assertion for
   computed layout and reachable bottom clearance.
3. Preserve the initiating Spectral Chains attack control across the chained
   modal sequence, or restore focus to a deterministic equivalent in the same
   attack row rather than the first global button.
4. Extend the E2E to enter Play Mode and use its target controls, drive Escape
   and manual Release through visible controls, and derive every returned flag
   from concrete post-action state. Specifically assert movement used/doubled
   pool/bonus state and first/duplicate/repeat recurring-damage results.
5. Correct the limitations and E2E catalog text only after those behaviors are
   verified.
