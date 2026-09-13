# Inspector Feedback — Iteration 3

## Verdict: FAIL

Iteration 3 fixes several iteration-2 defects: canonical TGTT source gating now
works, Spectral Chains checks both Rage and Manifest Chains, target-only hits are
representable, stale range/size/capacity and recurring damage are reconciled,
out-of-range movement releases the chain effects, distributed doubled movement
works after a successful first spend, Play Mode Rage teardown uses the shared
state service, and Quick Build successfully produced a level-3 Chained Fury
Barbarian with no unresolved choices.

The immutable goal is still not complete. Both isolated production-flow
Playwright commands are red, Play Mode doubled movement throws at runtime,
failed doubled-movement requests grant the doubled pool without spending a
bonus action, Chain Control can shove after the target succeeds on the grapple
save and accepts contradictory direction/final-position declarations, the
persisted effect layers mark ordinary grapples as restrained, the supposedly
generic target dispatcher remains Chained-Fury-specific, and the mobile modal
layout/focus/safe-area requirements remain unmet.

## Acceptance Criteria Check

- [ ] **All canonical level 3, 6, 10, and 14 values and mechanics match the TGTT data.** — **FAILED.** Damage dice, reach, magical damage, chain count, size scaling, restraint DC/damage, and the level-14 allowance match `TravelersGuidetoThelemar.json`. Chain Control and doubled movement still have incorrect behavior described below.
- [x] **Spectral Chains is a real feature-granted attack and requires both Rage and Manifest Chains.** — verified by focused Jest and direct runtime probes. A non-TGTT same-name subclass has no Chained Fury calculations/attack, and a malformed Manifest-only state exposes no attack or target mutation.
- [x] **A hit can select/create a target and resolve no rider, Grapple, or Shove through the target-aware flow.** — manually verified the real L3 Spectral Chains attack → Hit → rider picker → target modal. `Track target only` is offered, and direct state probes confirmed tracked and shove-only records do not occupy chains.
- [x] **Grapple/escape and Chain Imprisonment use distinct save contracts.** — focused tests and runtime probes confirm Strength/Dexterity against the current combat-method DC for grapple/escape and a separate Strength save against `8 + PB + CON` for restraint.
- [ ] **Target size, range, capacity, and re-grapple/API validation are correct.** — **FAILED.** Normal size/range/capacity checks work, but the state API accepts inconsistent metadata. At level 3, `{effect: "grapple", riderId: "chains-control-shove"}` succeeds and creates a shoved target even though Chain Control is unavailable. Validation is applied to `effect` while behavior is also inferred independently from `riderId`.
- [ ] **Persisted target state keeps stable IDs and reconciles all derived state.** — **FAILED.** Stable IDs, current DCs/damage, range, size, and capacity reconciliation work. However, every successful ordinary grapple is persisted with `restrained: false` but `effects.restraint.active: true` because `restraintSuccess` becomes true whenever `isRestrain` is false. The normalized effect model therefore contradicts itself.
- [x] **Recurring damage equals current Barbarian level with duplicate protection and repeat override.** — verified by Jest and level-change reconciliation probes.
- [ ] **Movement, drag cost, level-14 handling, and one-time doubled movement are correct.** — **FAILED.**
  - A successful doubled move establishes a shared pool that later moves can consume, and level 14 correctly removes only the drag surcharge.
  - A failed doubled move mutates `chainedMovementUsage.doubled = true` before checking the allowance. A subsequent move can use the doubled allowance while `bonusActionUsed` remains false.
  - Play Mode calls nonexistent `this._consumeActionType("bonus")`; clicking a successful doubled move throws `TypeError: this._consumeActionType is not a function` after mutating state.
- [ ] **Chain Control records and validates a legal declared final position after a successful grapple.** — **FAILED.** The modal now collects final distance and direction, but the API applies the shove even when the target succeeds on the initial grapple save. It also accepts contradictory declarations such as starting at 20 ft., direction `away`, and final distance 15 ft.; it verifies only that the scalar final distance is in range, not that the declared 10-foot movement and direction are coherent.
- [x] **All listed teardown paths remove active chain effects and occupancy.** — verified for Rage/Manifest teardown, rest clearing, out-of-range release, level/source/size/capacity reconciliation, escape, and manual release. The target identity may remain after an out-of-range release, but grapple, restraint, recurring damage, and occupancy are cleared as required.
- [x] **Level 14 permits three attacks only for an all-Spectral-Chains Attack action.** — focused mixed/all-chain allowance tests pass.
- [ ] **The target-aware path is generic and opt-in without regressing unrelated features.** — **FAILED.** The metadata gate is opt-in, but dispatch is not generic: `_pOfferTargetEffect` calls `getChainedTargets()` and `applyChainedTargetEffect()` directly, renders Chained Fury-specific labels, and synthesizes target-only metadata with hardcoded source `"chained-fury"`. The new generic `applyTargetEffect()` is not used by the production combat flow.
- [ ] **Combat and Play Mode provide the complete Chained Targets surface.** — **FAILED.** Both surfaces render the main data/actions, but Play Mode's doubled-movement action crashes. Capacity has no explicit persistent warning, and the Combat distance field remains only 80 px wide on a 390 px viewport.
- [ ] **Custom flows preserve focus, keyboard/ARIA behavior, 44 px controls, mobile single-column layout, safe-area clearance, and theme parity.** — **FAILED.** Fields/buttons are 44 px high and the initial target/escape focus is correct. Escape focus restoration now works. However, at 390×844 both target and escape modal footers remain a two-column flex row, modal bottom clearance is 0 px, target fields remain narrow inline controls rather than a single-column layout, and cancelling the target modal restores focus to `BODY` because its captured trigger is the dismissed enum modal's OK button.
- [x] **Builder, LevelUp, and QuickBuild ingest the subclass with no new subclass picker.** — normal Builder/LevelUp milestone tests pass. An independent `charSheet.spawn("barbarian/chained fury/3/minotaur")` run, which drives the real Builder and Quick Build engines, produced Barbarian 3 / Path of the Chained Fury (TGTT), `hasManifestChains: true`, no pending choices, no unresolved choices, and no unhandled prompts.
- [ ] **Targeted Jest comprehensively verifies calculations, transitions, persistence, teardown, movement/action economy, and progression.** — **FAILED.** The focused suite passes, but it misses the failed-double mutation, Play Mode action-economy crash, contradictory effect layers, mismatched rider/effect API bypass, Chain Control after a successful target save, and direction/final-distance consistency.
- [ ] **The Chained Fury E2E drives the real lifecycle, spends/restores Rage, retains concentration coverage, and concretely asserts every measurable feature.** — **FAILED.** The test reaches the real attack path but is still red in isolation. Its target lifecycle remains limited to one restrain, round-trip, and direct page-object release; it does not cover target-only, shove, save success/failure, movement, doubled movement, recurring damage/repeat, Escape UI, Play Mode, source/level teardown, or out-of-range release.
- [ ] **Focused Jest, focused Playwright, and RUN_MEGA coverage pass with no unexplained skips.** — **FAILED.** Jest passes, but both one-worker Playwright runs fail in the USE lifecycle test.
- [ ] **Relevant subsystem, toggle, limitations, and E2E documentation is accurate and updated.** — **FAILED.** The documents exist, but `13-tgtt-thelemar-homebrew.md` incorrectly states Chain Imprisonment uses `8 + PB + STR` instead of Constitution, `06-combat-system.md` claims generic metadata dispatch that the production flow does not implement, and `10-known-limitations.md` claims safe-area spacing that browser measurement disproves.

## Previous Feedback Verification

Every issue from iteration 2 was rechecked:

1. **Source gating:** fixed for canonical calculations, attacks, activation, and target mutation.
2. **Rage + Manifest gating / Play Mode teardown:** normal Play Mode toggling now uses `activateState`/`deactivateState`, so Rage teardown cascades; attack and target mutation independently require both states.
3. **Target-only path:** fixed; the UI offers `Track target only`.
4. **Low-level unavailable restraint:** fixed for a matching `effect: "restrain"`, but API validation remains bypassable through inconsistent `riderId`/`effect` pairs.
5. **Derived reconciliation:** largely fixed for DC, damage, size, range, and capacity; the contradictory restraint effect layer remains.
6. **Out-of-range release:** fixed; active effects and occupancy are removed rather than clamped.
7. **Distributed doubled movement:** fixed for successful moves, but failed requests leak the doubled allowance and Play Mode throws on bonus-action consumption.
8. **Declared Chain Control position:** fields were added, but successful-grapple gating and direction/10-foot consistency are not enforced.
9. **Generic target-effect plumbing:** not fixed; the production modal and mutation dispatch are still hardcoded to Chained Fury.
10. **Mobile/accessibility:** touch heights and Escape focus restoration improved; single-column modal layout, safe-area clearance, Combat distance width, and target-modal focus restoration remain broken.
11. **Quick Build and real lifecycle E2E:** Quick Build works independently through the spawn pipeline; the committed Chained Fury lifecycle remains shallow and fails both isolated runs.

## Independent Runtime Evidence

1. A resisted Chain Control grapple (`grappleSaveTotal === DC`) returned `grappled: false` but `shoved: true` and moved the target.
2. A normal successful grapple returned `restrained: false` while persisting `effects.restraint.active: true`.
3. At level 3, a mismatched `chains-control-shove` rider combined with `effect: "grapple"` bypassed the level-10 availability gate and created a shoved target.
4. With speed 10, a doubled move costing 30 correctly failed against allowance 20, but left `{doubled: true, bonusActionUsed: false}`. A following non-doubled move costing 16 then succeeded using the free doubled allowance.
5. In Play Mode, selecting Double movement and moving a target mutated the target and movement pool, then threw `TypeError: this._consumeActionType is not a function`.
6. Chain Control accepted start 20 ft. → final 15 ft. with direction `away`.
7. Save/load preserved target IDs; level 14 → 10 reconciliation reduced occupancy from four to two and updated restrained damage to 10.
8. Out-of-range movement released grapple/restraint/recurring damage/occupancy while preserving the lightweight target record.

## Browser Verification

- **Desktop:** manually exercised the production L3 Spectral Chains attack, Hit prompt, rider selector, and target modal. The target modal opened and initially focused Target name.
- **Mobile Combat (390×844):** target action buttons measured 44 px high, but the distance input remained 80 px wide. The target and Escape modal footers computed as `display:flex`, placed two 180 px buttons side-by-side, and touched the viewport bottom with 0 px clearance.
- **Mobile Play Mode (390×844):** target controls stacked to the available width and measured 44 px high. A doubled move threw the missing-method error above.
- **Focus:** Escape modal cancellation restored focus to its trigger. Target-modal cancellation left focus on `BODY`.
- **Quick Build:** the real spawn/Quick Build pipeline successfully built a level-3 TGTT Chained Fury Barbarian with no pending or unresolved choices.

## Quality Gate

- Command: `npm run test:unit -- CharacterSheetChainedFury CharacterSheetTargetEffects CharacterSheetCombat CharacterSheetToggleAbilities --no-coverage --forceExit`
  - Result: **PASS**
  - Details: 26 suites, 784 tests passed.
- Command: focused ESLint on the changed Character Sheet and target-effect Jest files
  - Result: **PASS**
- Command: `npm run test:css`
  - Result: **PASS**
- Command: `npx playwright test test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts --reporter=list --workers=1`
  - Result: **FAIL**
  - Details: 5 passed, 2 expected MEGA skips, 1 failed. The USE test timed out waiting for `[data-target-name]` after the on-hit selection.
- Command: `RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts --reporter=list --workers=1`
  - Result: **FAIL**
  - Details: both MEGA walks passed, but the USE test failed before the target lifecycle because no Hit prompt appeared; overall result 7 passed, 1 failed.
- Command: `npm run test:js`
  - Result: **FAIL**
  - Details: the same 14 pre-existing errors in unchanged bestiary files and `CharacterSheetNpcExporter.attachmentCorpus.test.js`.
- Command: `npm test`
  - Result: **FAIL**
  - Details: stopped at the same pre-existing JavaScript lint failures.

## Issues Found

1. The committed production-flow E2E remains nondeterministic/red in both isolated one-worker runs.
2. Play Mode doubled movement calls a nonexistent method and throws after state mutation.
3. A rejected doubled move leaks doubled movement without consuming the bonus action.
4. Chain Control is applied even when the initial grapple fails and does not validate direction/10-foot displacement consistency.
5. Ordinary grapple records incorrectly set the restraint effect layer active.
6. API validation can be bypassed by mismatching `riderId` and `effect`.
7. The target-aware UI/state dispatcher remains Chained-Fury-specific rather than generic metadata dispatch.
8. Mobile modal layout, safe-area clearance, Combat distance sizing, target-modal focus restoration, and explicit capacity warning behavior remain incomplete.
9. Jest/E2E coverage does not exercise the failing branches above.
10. Documentation contains a wrong restraint-DC formula and overstates generic dispatch and mobile safe-area support.

## What Must Be Fixed

1. Make the isolated real Spectral Chains lifecycle deterministic and green in both normal and `RUN_MEGA=1` runs; then extend it across the required target, save, movement, recurring-damage, Play Mode, persistence, and teardown branches.
2. Route Play Mode bonus-action use through a real shared action-economy API, check availability before mutating movement, and save/re-render only after the complete operation succeeds.
3. Do not set `doubled` until validation succeeds; make the movement operation transactional on every failure.
4. Apply Chain Control only after a successful grapple and validate that declared direction/final position represents a legal 10-foot shove.
5. Set restraint state/effect active only for Chain Imprisonment and keep all compatibility aliases consistent.
6. Validate one canonical metadata contract rather than deriving behavior separately from `effect` and `riderId`.
7. Make `_pOfferTargetEffect` dispatch through generic source metadata/handlers and `applyTargetEffect`, without Chained Fury-specific source, copy, labels, or mutation calls in the generic path.
8. Fix the mobile selectors so target fields and modal actions actually form one column, add safe-area bottom padding, widen the Combat distance input, and restore target-modal focus to a connected player control.
9. Add focused tests that fail on each issue above, including direct Play Mode interaction.
10. Correct the documentation to use Constitution for Chain Imprisonment and describe only behavior that is actually implemented.
