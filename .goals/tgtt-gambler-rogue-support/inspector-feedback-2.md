# Inspector Feedback — Iteration 2

## Verdict: FAIL

## Acceptance Criteria Check

- [x] Gambler's Tools grants card-set and dice-set proficiency, creates correct coin/dice/card attacks, and applies the coin half-cover rider without leaking to other characters.
  - Targeted Jest verifies all three equipped weapons and the structured coin rider.
  - An independent source-change probe confirmed that Playing Card Set/Dice Set proficiencies and synthesized weapons are removed after the character stops being a TGTT Gambler.
- [ ] Gambler spellcasting uses the exact published cantrip and slot progression, rolls the correct daily prepared-spell allowance, and rolls one cast-scoped Gambling Modifier reused across every attack/save produced by that cast.
  - The targeted tests pass for the published slot/cantrip/prepared-dice progression.
  - The production cast path supplies `gamblerCastResolution.modifier` to the shared attack/save calculation, but the required browser regression does not execute: the new MEGA matrix fails at L3 because the three added state methods are reported missing in the browser.
  - The added Playwright rows call state APIs directly rather than exercising a real spell cast and rendered attack/save output, contrary to the updated E2E documentation.
- [ ] Gambler's Folly uses exact wager odds for spell levels 1-4, triggers the Gambling Table on a loss, and handles slot/cast overrides such as result 49 atomically.
  - Wager odds and the result-49 receipt descriptor pass targeted Jest, and a planted `preserveSlot` violation is caught.
  - **FAILED:** result 61 suppresses the immediate cast, consumes the slot, commits/removes the receipt, and has no later execution path. `delayedCast` is only written in state and read once to set `deferCast`; no scheduler or resume operation exists.
  - **FAILED:** result 33 only casts Color Spray if Color Spray is already present in `state.getSpells()`. Otherwise the sheet displays “Color Spray is unavailable,” so the canonical free cast is not actually performed.
- [ ] Extra Luck works on attack rolls, saving throws, ability checks, and skill checks; atomically spends its PB-scaled long-rest resource and required bonus action; and spends nothing when declined or cancelled.
  - The generic roll prompt is wired into attack, save, ability-check, and skill-check paths, and declining the prompt does not call the spend API.
  - **FAILED:** Play Mode and Gambler still use separate bonus-action stores. Setting Play Mode's `_actionEconomy.bonus` false leaves `state.isBonusActionAvailable()` true; spending the state bonus action leaves Play Mode showing its bonus action as available. The iteration only synchronized Reset Turn.
  - **FAILED regression gate:** changing `useExtraLuck` back to `consumeBonusAction = false` left all 106 targeted tests green. The tests therefore do not prove the public API cannot bypass the required bonus-action cost.
- [x] Versatile Gambler changes prepared-spell dice to 3d6 and Gambling Modifier dice to 2d4 at Rogue level 13.
  - Verified in targeted Jest.
  - A planted change making `CharacterSheetGamblerRules.getModifierDice()` always return `1d6` failed the focused test as expected.
- [ ] Master of Fortune changes a natural 1 to a natural 20, updates downstream critical/fumble interpretation, rolls twice on the Gambling Table, requires a player choice, spends its PB-scaled long-rest resource, and preserves unresolved/resolved choices across save/load.
  - The d20 mutation and downstream natural-roll update are implemented, and direct state tests cover the resource, double roll, choice, and serialization.
  - **FAILED:** Gambling Table rolls produced by Extra Luck/Master of Fortune use only the global `gamblerLastTableRoll` modal. Choosing a result does not call the descriptor effect layer, so the selected condition/modifier/transaction is not applied.
  - The browser suite does not cover the real fortune prompt, choice, effect application, or restored choice UI.
- [ ] Every one of the 100 canonical Gambling Table rows has an explicit implementation descriptor. Safe self/spell effects use existing active-state, condition, modifier, resource, and spell transaction systems; target/world/DM-adjudicated effects remain explicit durable manual resolutions with no silent no-op.
  - All 100 numbers have generated objects, but 85 still use the same fallback manual descriptor. Thirty self-scoped rows and thirteen spell-changing rows remain manual, including spell-radius/duration/effectiveness/save changes.
  - Row 13 is incorrectly modeled as a speed multiplier even though the canonical result is the Reduce effect of Enlarge/Reduce. The applied named modifier does not change walking speed.
  - Row 20's active state halves speed, but its documented `-4` initiative effect does not change `getInitiative()` (observed `0 → 0`).
  - The tests assert descriptor shape for row 20 but not its effects. In an isolated planted check, replacing row 20's `effects` with `[]` left all 106 targeted tests green.
  - Result 61 has no delayed execution, and result 33 is conditional on already knowing Color Spray.
- [x] All Gambler randomness uses a per-sheet injectable RNG seam in tests and genuine production randomness otherwise; tests do not globally monkeypatch Math.random.
  - Verified by source inspection and the deterministic-roll Jest test.
- [ ] Builder, LevelUp, QuickBuild, respec, rest, save/load, and TGTT source gating produce consistent level-correct behavior with backward-compatible defaults and cleanup.
  - Synthesized weapon/resource/receipt cleanup and long-rest resets are improved.
  - **FAILED:** name-only Gambler checks remain in spellcasting/picker paths. A PHB Rogue with a same-named PHB `Gambler` subclass reports rolled-prepared Gambler spellcasting, uses the Warlock list, and creates three pending Warlock cantrip choices even though `hasGamblerSpellcasting` is false.
  - A planted removal of `_getGamblerClass()`'s source checks did not fail the focused source-gating test, showing that the regression test does not cover these name-only consumers.
  - The required MEGA LevelUp/feature-matrix flow is red, and no new QuickBuild/restored-flow browser coverage was added.
- [ ] Wager, prepared-spell, fortune-intervention, result-choice, resource, confirmation, error, pending, and restored states follow the existing Character Sheet design system and are keyboard-accessible, screen-reader-legible, responsive, and usable on mobile.
  - A pending-receipt section was added to the existing Gambling Table modal.
  - **FAILED:** restored receipts cannot complete the transaction lifecycle. Choosing a restored receipt clears its buttons and requires reopening; a resulting `ready` automatic receipt has no action, and applied/acknowledged receipts have no commit/resume-cast action and remain pending.
  - Cancelling the immediate choice/confirmation deletes the receipt rather than preserving an unresolved cast.
  - No dedicated responsive styling or browser assertions cover pending/restored, keyboard, screen-reader, error, or mobile behavior.
- [ ] Targeted Jest tests assert real state/effect changes and are demonstrated to fail against planted violations before final validation.
  - Baseline targeted Jest passes: 2 suites, 106 tests.
  - Planted result-49 and modifier-dice violations fail as expected.
  - **FAILED:** the default Extra Luck bonus-action bypass plant and the row-20 no-effect plant both leave all 106 tests green.
  - The new table test checks row IDs/effect types and only proves real application for row 2 and row 9. Independent probes showed row 13 has no speed effect and row 20 has no initiative effect.
- [ ] The Gambler Playwright spec covers every measurable subclass feature with deterministic real-effect probes and passes normally and with `RUN_MEGA=1`; shared E2E helper changes pass the full TGTT suite.
  - Normal command: PASS, 6 passed and 2 expected MEGA/matrix skips.
  - **FAILED required MEGA command:** 6 passed, 2 failed. Both MEGA tests stop at L3 because `setGamblerRollScenario`, `createGamblerCastResolution`, and `getPendingGamblerCastResolutions` are reported missing in the browser.
  - The added probes are direct state-shape calls, not real cast/UI/effect probes. They do not cover result 49 slot mutation, result 61 delayed execution, result 33 free casting, Extra Luck prompts/cancellation, table-effect application, or restored pending UI.
  - No shared E2E helper/page-object files changed, so the conditional full TGTT suite was not required.
- [ ] Related Character Sheet, TGTT, testing, E2E, audit, and known-bug documentation is updated.
  - Character Sheet, E2E, and audit documents were updated.
  - **FAILED:** the documentation overstates implementation. It claims safe self effects and delayed casting work, while row 13/20 effects are incorrect or ineffective and result 61 is never executed later.
  - The E2E document says receipt browser probes should use a page object/shared helper and direct state calls belong in Jest, but the new Gambler spec adds direct state calls.
  - No corresponding known-bug documentation update was committed.

## Quality Gate

- Command: `npm run test:unit -- test/jest/charactersheet/CharacterSheetTGTTGambler.test.js test/jest/charactersheet/CharacterSheetTGTTGamblerEffects.test.js --no-coverage --forceExit`
  - Result: PASS
  - Details: 2 suites, 106 tests passed.
- Planted failure: remove TGTT checks from `_getGamblerClass()`
  - Result: FAIL (gate weakness)
  - Details: the focused source-gating test still passed, while an independent wrong-source probe demonstrated leaked rolled-prepared/Warlock-list behavior.
- Planted failure: change result 49 from `preserveSlot` to `consumeSlot`
  - Result: PASS
  - Details: the focused test failed as expected.
- Planted failure: force `CharacterSheetGamblerRules.getModifierDice()` to return `1d6`
  - Result: PASS
  - Details: the focused Versatile Gambler test failed as expected.
- Planted failure: make `useExtraLuck()` default to `consumeBonusAction = false`
  - Result: FAIL (gate weakness)
  - Details: all 106 targeted tests still passed.
- Planted failure: remove all row-20 active-state effects
  - Result: FAIL (gate weakness)
  - Details: all 106 targeted tests still passed.
- Command: `npx playwright test test/e2e/specs/tgtt-gambler-rogue-clairnian.spec.ts --reporter=list`
  - Result: PASS
  - Details: 6 passed, 2 skipped.
- Command: `RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-gambler-rogue-clairnian.spec.ts --reporter=list`
  - Result: FAIL
  - Details: 6 passed, 2 failed at L3 because the new deterministic receipt state methods were missing in the browser runtime.
- Command: `node scripts/auditE2eCoverage.mjs --strict`
  - Result: FAIL overall
  - Details: Gambler reports FULL/111%, but 13 repository specs remain below threshold. The metric does not detect the broken Gambler runtime calls.
- Command: `npm run lint`
  - Result: FAIL
  - Details: 7 ESLint errors in bestiary quick-action files. Lint auto-fixes to unrelated files were restored before this review commit.
- Command: `npm test`
  - Result: FAIL
  - Details: stopped in `test:js` on the same 7 ESLint errors.

## Issues Found

1. **The required MEGA browser gate is red.** The new L3 receipt probes cannot call the methods they were added to test.
2. **The Playwright coverage is state-shape coverage, not user-flow coverage.** It does not cast through the UI, observe real slot changes/output, resolve modal states, or restore pending receipts.
3. **The Gambling Table layer is still incomplete and partly incorrect.** Eighty-five rows use the generic manual fallback; row 13 models the wrong mechanic; row 20's initiative penalty is inert; spell-changing rows remain manual.
4. **Result 61 loses the spell.** The slot is consumed, rendering is deferred, the receipt is committed/removed, and no code later performs the cast.
5. **Result 33 is not canonical.** It only works if Color Spray is already on the character's spell list.
6. **Extra Luck is not integrated with Play Mode action economy.** The UI and state can disagree in both directions.
7. **Fortune-triggered table results are not applied.** Extra Luck/Master of Fortune display and choose a global result but never execute its descriptor.
8. **Wrong-source Gambler behavior still leaks through name-only spellcasting checks.**
9. **Restored receipt UI cannot resume and commit a cast transaction.**
10. **Regression tests remain vulnerable to false greens.** Bonus-action bypass and removal of a real row-20 effect are not detected.
11. **Required repository gates remain red.**

## What Must Be Fixed

1. Make the MEGA Gambler command pass and replace the new direct state-shape rows with page-object/shared-helper probes that exercise real casting, slot mutation, rendered attack/save values, pending choices, confirmations, cancellation, restoration, and effect application.
2. Unify Play Mode's bonus-action display/control with the state consumed by Extra Luck. Add tests that manually spend/restore the UI bonus action and prove Extra Luck cannot bypass it.
3. Implement and test a real delayed-cast lifecycle for row 61, including persistence and eventual execution, or keep it as a durable unresolved manual transaction without consuming/discarding the spell.
4. Cast row 33's Color Spray from canonical spell data regardless of whether the character knows/prepared it.
5. Replace fallback/manual descriptors for safely modelable self/spell rows with row-specific descriptors and real effects. Correct row 13, fix row 20's initiative penalty, and add derived-state assertions for every automated row.
6. Route Gambling Table results from Extra Luck and Master of Fortune through the same effect/acknowledgement lifecycle as cast receipts.
7. Remove all name-only Gambler spellcasting/picker special cases or gate them by TGTT class/subclass source and the TGTT setting. Add negative tests for `getSpellcastingInfo`, pending cantrip choices, picker class substitution, and save/load.
8. Make restored receipt controls advance, apply, commit/resume, and clean up the actual cast transaction; cover keyboard, screen-reader, responsive/mobile, pending, error, and restored states.
9. Add planted-failure checks that catch a default bonus-action bypass and no-op/incorrect table effects.
10. Correct the documentation to match the real behavior and restore `npm run lint`, `npm test`, and the required MEGA Playwright gate to green.
