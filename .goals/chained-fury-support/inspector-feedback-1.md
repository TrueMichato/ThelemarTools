# Inspector Feedback — Iteration 1

## Verdict: FAIL

## Acceptance Criteria Check

- [ ] All canonical level 3, 6, 10, and 14 values and mechanics match TGTT — FAILED: the existing damage/range/magical/count/size/DC scalars pass, but the target lifecycle does not implement the canonical grapple save, drag movement costs, doubled chain-only movement, or level-14 movement rule.
- [ ] Spectral Chains is gated by Rage and Manifest Chains and cannot retain targets otherwise — FAILED: attack creation and explicit state deactivation are gated, but removing the Barbarian/subclass at runtime leaves an occupied Chained Fury target until a later load reconciliation.
- [ ] A hit can select/create a target and resolve no rider, Grapple, or Shove — FAILED: there is no target-only/no-rider result, and the Shove path unconditionally sets `grappled: true` and consumes a chain.
- [ ] Grapple/escape use the TGTT Strength-or-Dexterity save contract and Chain Imprisonment uses its separate Strength save — FAILED: Chain Imprisonment has the separate Constitution-based DC, but initial grapple has no save resolution and Escape accepts only an unlabeled numeric total with no Strength/Dexterity choice.
- [ ] Target size, range, capacity, and re-grapple semantics are validated — FAILED: basic size/range/count checks exist and an existing ID is updated, but invalid rider/state combinations can still create occupancy (for example, a level-5 `chains-restrain` request creates a grappled target).
- [ ] Targets persist with stable IDs while derived values recalculate — FAILED: IDs persist, but a level-6 target loaded as level 10 retained damage 6, escape DC 15, and restraint DC 14 while the current derived values were 10, 16, and 15.
- [ ] Recurring damage equals current Barbarian level and supports duplicate protection plus explicit repeat override — FAILED: duplicate protection exists, but persisted damage is stale after level changes and no repeat override exists.
- [ ] Chained movement validates range, applies size-adjusted drag cost, handles level 14, and consumes the bonus action once — FAILED: `moveChainedTarget` only replaces the stored distance. It tracks no movement budget, size surcharge, level-14 exception, doubled movement, or bonus-action consumption.
- [ ] Level 10's immediate shove validates the final distance — FAILED: the implementation records a 10-foot shove flag/distance but never calculates or validates the target's declared final distance after the shove.
- [ ] Every listed teardown path atomically clears the effect — FAILED: Rage/Manifest deactivation and stale-load reconciliation clear effects, but runtime class/subclass/source removal and level-down are not reconciled; out-of-range movement is rejected while retaining the target. Other listed rest/respec paths lack targeted verification.
- [ ] Level 14 permits exactly three all-chain attacks while mixed actions keep the normal allowance — FAILED: `_getAttackActionAllowance` returns 3 correctly, but `_canRollAttackActionAttack` only enforces an allowance while `awakenedAstralSelf` is active. A live level-14 probe reported `allowance: 3` and `canRollFourth: true`.
- [ ] The target-aware path is generic and opt-in without regressing old behavior — FAILED: old prompt-only tests pass, but Combat dispatch is hard-coded to `opt.id.startsWith("chains-")`, so the persisted target-aware path is not reusable as required.
- [ ] Combat and Play Mode provide the complete Chained Targets surface — FAILED: both surfaces show name, size, distance, state, damage, and actions, but neither renders the required range/capacity warnings; the display also cannot represent a target-only/no-rider or shove-only state correctly.
- [ ] Custom flows meet modal, focus, keyboard, ARIA, mobile sizing/layout, safe-area, and theme requirements — FAILED: the target picker uses `CharacterSheetModal` and focuses the name field, but mobile inspection at 390 px showed 23–29 px form controls, 26 px action buttons, side-by-side fields/actions rather than a single-column layout, and a footer flush to the viewport bottom. No Chained Targets CSS or day/night token work was added. Escape uses a separate `InputUiUtil` number flow.
- [ ] Builder, LevelUp, and QuickBuild ingest the subclass consistently without a picker — FAILED: Builder/LevelUp progression passed the focused matrix, but no QuickBuild-specific verification was added or found for this change.
- [ ] Targeted Jest covers calculations, transitions, migrations, teardown, movement/action economy, and progression, with a red-gate proof — FAILED: the new suite contains five happy-path tests and omits grapple saves, shove-only behavior, derived-value recalculation, repeat override, drag/action economy, level-down/respec/source teardown, and progression gates. No fail-before-fix evidence is present.
- [ ] The Chained Fury E2E drives the actual attack/lifecycle, spends/restores Rage, retains concentration coverage, and asserts every measurable feature — FAILED: `targetLifecycle` directly activates states and calls `applyChainedTargetEffect`; it never rolls Spectral Chains or uses the target modal. It runs at level 5 while requesting the level-6 restrain rider, and only asserts `grappled`, so that invalid path passes. It does not prove Rage spending/restoration as part of the chain flow.
- [x] Focused Jest, focused Playwright, and `RUN_MEGA=1` matrix coverage pass without unexplained skips — verified: Jest passed 26 suites/776 tests; focused Playwright passed 6 with only the two environment-gated MEGA tests skipped; `RUN_MEGA=1` passed all 8 tests.
- [ ] Relevant subsystem, toggle, limitations, and E2E catalog documentation is updated — FAILED: only the state-management and combat-system pages were updated; toggle/limitations/E2E catalog documentation was not updated.

## Quality Gate

- Command: `npm run test:unit -- CharacterSheetChainedFury CharacterSheetTargetEffects CharacterSheetCombat CharacterSheetToggleAbilities --no-coverage --forceExit`
- Result: PASS
- Details: 26 suites and 776 tests passed.
- Command: `npx playwright test test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts --reporter=list`
- Result: PASS
- Details: 6 passed; the two MEGA-only cases were skipped as expected without `RUN_MEGA=1`.
- Command: `RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts --reporter=list`
- Result: PASS
- Details: all 8 tests passed.
- Command: `npm run test:css`
- Result: PASS
- Command: `npm run test:js`
- Result: FAIL (unrelated baseline)
- Details: 14 lint errors are confined to unchanged bestiary quick-action files and `CharacterSheetNpcExporter.attachmentCorpus.test.js`. Focused ESLint on the modified JavaScript/Jest files passed; the E2E TypeScript files are outside this ESLint configuration.
- Command: `npm test`
- Result: FAIL (same unrelated baseline)
- Details: the aggregate command stops at the same pre-existing `test:js` failures before later stages.

## Browser Verification

- Desktop Combat tab: the target card rendered and exposed Release, Move, recurring damage, and Escape controls at 44 px height.
- Desktop Play Mode: the same persisted target rendered with the expected controls.
- Mobile at 390 × 844: both target surfaces were cramped multi-row layouts rather than the required single-column layout.
- Mobile target modal: focus landed on Target name and labels were exposed, but inputs/selects were 23–29 px high, Apply/Cancel were 26 px high, fields shared rows, and the footer had no visible safe-area clearance.

## Issues Found

1. **The target model conflates target presence, grapple, shove, restraint, and chain occupancy.** Every applied rider sets `grappled: true`; therefore Shove is mechanically wrong and there is no no-rider target record.
2. **Grapple resolution is missing.** The player cannot record the target's chosen Strength or Dexterity save for the initial grapple or escape as required by the TGTT method contract.
3. **Movement/action economy is unimplemented.** Stored distance changes do not spend movement, apply drag surcharge, use size, consume a bonus action, or implement the level-14 exception.
4. **Derived and stale state is not reconciled.** Load only removes illegal/out-of-range entries; it does not recalculate DCs, recurring damage, size legality, capacity, or chain indexes. Runtime class/subclass changes do not invoke reconciliation.
5. **Recurring damage has no repeat override.**
6. **The level-14 attack cap is not enforced.** The allowance calculation exists, but the gate is accidentally conditional on Astral Self.
7. **The E2E probe bypasses the behavior it claims to test.** It calls the state API at level 5 instead of rolling Spectral Chains and exercising the modal, save, display, movement, escape, teardown, persistence, and Rage resource flow.
8. **Responsive/accessibility acceptance is incomplete.** The modal and target cards have undersized and crowded mobile controls, and no dedicated responsive/theme styles were added.
9. **Documentation and test coverage are materially incomplete relative to the goal.**

## What Must Be Fixed

1. Separate lightweight target identity from attached effects/chain occupancy so no-rider and shove-only outcomes do not create grapples.
2. Implement target-chosen Strength/Dexterity grapple and escape saves against the current method DC, while retaining Chain Imprisonment's independent Strength save/DC.
3. Add complete movement accounting: declared start/final distance, range validation, size-adjusted drag cost, level-14 surcharge removal, doubled chain-only movement, and one-time bonus-action consumption.
4. Validate Chain Control's final position after the 10-foot shove.
5. Recompute all derived target fields on access/load and reconcile capacity, size, source, level, subclass, active state, range, rest/reset, incapacity/death, and respec/level-down transitions.
6. Add an explicit recurring-damage repeat override.
7. Fix Attack-action gating so a fourth Spectral Chains attack is blocked and mixed actions remain at the normal allowance.
8. Make the target-aware lifecycle generic/data-driven rather than dispatching by `chains-` IDs.
9. Redesign the Combat, Play Mode, and modal UI for a true single-column mobile layout, 44 px controls, safe-area spacing, warnings, and day/night token parity.
10. Expand Jest and Playwright to cover every lifecycle and progression rule. The E2E must roll the actual Spectral Chains attack, use the player-facing target flow, spend/restore Rage, save/load, move, resolve damage, escape/release, and verify teardown.
11. Add the missing QuickBuild, toggle, limitations, and E2E catalog documentation/verification.
