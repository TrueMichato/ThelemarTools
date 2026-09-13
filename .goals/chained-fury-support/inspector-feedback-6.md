# Inspector Feedback — Iteration 6

## Verdict: FAIL

Iteration 6 fixes several iteration-5 defects. Play Mode now restores only the
requested action slot in shared state, the mobile target modal is scrollable and
its footer genuinely stacks into one column, the focused Jest and isolated
one-worker Playwright runs are green, and the E2E now enters Play Mode for
Escape and Release.

The goal is still incomplete. A real Play Mode slot interaction appends a second
visible **Your Turn** action-economy card instead of updating the existing card.
The target modal still returns focus to `BODY`, not the initiating Spectral
Chains attack. The E2E's new manual-release assertion is vacuous because it
creates a target-only record and considers success to mean that the record has
no grapple/restrain/shove flags—conditions already true before Release is
clicked. It also still does not exercise duplicate recurring-damage prevention:
it clicks normal resolution once and then Repeat, never a second normal
resolution. Documentation consequently overstates the verified behavior.

## Acceptance Criteria Check

- [x] **All canonical level 3, 6, 10, and 14 Chained Fury values and mechanics match the TGTT data.** — verified by the feature calculations, focused Jest, and the passing level matrix: damage die/range, magical force damage, chain count, size scaling, Constitution restraint DC, recurring damage, Chain Control distance, level-14 movement, and all-chain attack allowance remain correct.
- [x] **Spectral Chains is a real feature-granted attack and requires Rage plus Manifest Chains.** — verified by focused tests and the real browser attack flow.
- [x] **A hit can select/create a lightweight target and resolve target-only, Grapple, or Shove.** — the real attack, hit prompt, rider picker, and target modal remain operational.
- [x] **Initial grapple/escape and Chain Imprisonment use distinct save contracts.** — focused Jest verifies Strength/Dexterity against the current grapple-method DC and the independent Strength save against `8 + PB + CON`.
- [x] **Target size, range, capacity, and same-target update behavior are validated.** — focused state tests remain green.
- [x] **Target state persists with stable IDs and recalculates derived values.** — focused persistence/reconciliation tests and the E2E round trip pass.
- [x] **Restrained recurring damage equals current Barbarian level with duplicate protection and repeat override.** — the state behavior is verified by focused Jest.
- [x] **Movement is declared, range-checked, size-adjusted, level-14-correct, distributable, transactional, and consumes one bonus action.** — focused tests and the E2E movement-state assertions pass.
- [x] **Chain Control applies only after a successful grapple and validates a coherent 10-foot declaration.** — focused tests cover resisted control and direction/final-distance validation.
- [x] **All required teardown paths atomically clear active chain effects and occupancy.** — focused teardown/reconciliation tests remain green.
- [x] **Level 14 grants three attacks only for an all-Spectral-Chains Attack action.** — focused mixed/all-chain allowance tests and the matrix pass.
- [x] **The target-aware path is generic and opt-in without regressing unrelated behavior.** — source metadata dispatch and canonical conflict checks remain intact.
- [ ] **Combat and Play Mode expose a complete, coherent Chained Targets surface.** — **FAILED.** Restoring Bonus now changes only Bonus in shared state, but the handler calls `_renderActionEconomy()` without replacing the prior card. One click changed the live Play Mode DOM from one visible `.pm-economy` row to two; the stale row still said `Restore Bonus` while the appended row said `Use Bonus`.
- [ ] **Custom flows meet modal, focus, ARIA, mobile sizing/layout, safe-area, and theme requirements.** — **FAILED.** At 390×844 the target modal is now scrollable (`clientHeight` 590, `scrollHeight` 799), the footer computes as a one-column grid, both buttons are 360×44 px, and scrolling to the bottom leaves about 40 px of clearance. However, after the real Spectral Chains → Hit → Chain Imprisonment → Cancel flow, focus was still `document.body` after one second rather than the initiating attack control.
- [x] **Builder, LevelUp, and QuickBuild ingest the subclass without a new picker.** — the Playwright progression coverage passes and strict Quick Build produced Barbarian 3 / Path of the Chained Fury with no unresolved choices or unhandled prompts.
- [ ] **Targeted Jest verifies calculations, transitions, persistence, teardown, movement/action economy, and progression at the real gates.** — **FAILED.** The focused suite passes 792 tests, but the new restoration tests call the state API directly (or a mock of it). They do not exercise the Play Mode control and therefore did not catch the duplicated action-economy card or stale rendered control. No regression covers the still-broken target-modal focus return.
- [ ] **The Chained Fury E2E drives the actual Spectral Chains attack and complete target lifecycle.** — **FAILED.** It now drives the real rider picker, target modal, movement controls, Play Mode Escape, and a Play Mode Release click. But `releasePlayModeTarget()` returns true when no matching record has active grapple/restrain/shove flags. The “Manual release” branch deliberately creates `effect: "target"`, which has none of those flags before the click, so the assertion passes even if Release fails to remove the target. Recurring damage also lacks the required duplicate normal-resolution attempt; only first resolution and explicit Repeat are exercised.
- [x] **Focused Jest, focused Playwright, and `RUN_MEGA=1` matrix coverage pass without unexplained skips.** — fresh one-worker runs passed: normal 6 passed with the two expected MEGA skips; `RUN_MEGA=1` passed all 8 tests.
- [ ] **Relevant subsystem, toggle, limitations, and E2E documentation is accurate.** — **FAILED.** The E2E catalog claims duplicate/repeat checks and verified manual Release, but the test does not perform a duplicate normal resolution and its release predicate is true before the click. `10-known-limitations.md` also still claims modal close restores focus to the connected player control, which the browser probe disproves.

## Previous Feedback Verification

1. **Per-slot restoration:** the state mutation is fixed. Restoring Bonus leaves
   Action and Reaction spent.
2. **Play Mode regression coverage:** incomplete. The real control duplicates
   the action-economy card, while the added Jest tests bypass rendering.
3. **Mobile footer:** fixed. The computed layout is one column with 44 px
   full-width buttons, a scrollable modal body, and reachable bottom clearance.
4. **Target-modal focus:** not fixed. The real cancel flow still lands on
   `BODY`.
5. **Play Mode Escape:** now exercised through the visible Play Mode modal and
   asserts the target is no longer grappled/restrained.
6. **Manual Release:** a visible Release button is clicked, but the assertion
   cannot prove removal because it is applied to an already effect-free
   target-only record.
7. **Movement assertion:** fixed. The E2E reads the doubled pool, bonus-action
   usage, used distance, and remaining distance before and after a second move.
8. **Recurring-damage assertion:** partially fixed. First and explicit-repeat
   markers are checked, but duplicate prevention is still not exercised.

## Browser Verification

- Loaded the passing L11 Chained Fury export, activated Rage and Manifest
  Chains, and used the real Spectral Chains attack flow.
- At 390×844, the target modal's scroller measured 590 px high with 799 px of
  content and `overflow-y: auto`.
- The footer computed as `display: grid` with one 360 px column; both actions
  measured 360×44 px. At maximum scroll, the footer ended about 40 px above the
  modal bottom.
- Cancelling the target modal left `document.activeElement === document.body`
  after the modal teardown completed.
- With Action, Bonus, and Reaction spent, clicking **Restore Bonus** correctly
  produced `{action:false, bonus:true, reaction:false}` in shared state, but
  left two visible **Your Turn** cards/two `.pm-economy` rows in Play Mode.

## Quality Gate

- Command: `npm run test:unit -- CharacterSheetChainedFury CharacterSheetTargetEffects CharacterSheetCombat CharacterSheetToggleAbilities --no-coverage --forceExit`
  - Result: **PASS**
  - Details: 26 suites, 792 tests passed.
- Command: focused ESLint on the changed Character Sheet and target-effect Jest files
  - Result: **PASS**
- Command: `npm run test:css`
  - Result: **PASS**
- Command: `npm run spawn -- "barbarian/chained fury/3/minotaur" --strict`
  - Result: **PASS**
  - Details: Barbarian 3 / Path of the Chained Fury, no unresolved choices or unhandled prompts.
- Command: `PW_PORT=8975 npx playwright test test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts --reporter=list --workers=1`
  - Result: **PASS**
  - Details: 6 passed, 2 expected MEGA skips.
- Command: `PW_PORT=8976 RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts --reporter=list --workers=1`
  - Result: **PASS**
  - Details: all 8 tests passed, including the feature matrix.
- Command: `npm run test:js`
  - Result: **FAIL (pre-existing unrelated baseline)**
  - Details: the same 14 errors in unchanged bestiary quick-action files and `CharacterSheetNpcExporter.attachmentCorpus.test.js`.
- Command: `npm test`
  - Result: **FAIL (same pre-existing unrelated baseline)**
  - Details: stopped at the same JavaScript lint failures.

## Issues Found

1. Play Mode action-slot toggles append duplicate **Your Turn** cards and leave
   stale controls visible.
2. Target-modal cancellation still fails to restore focus to the initiating
   Spectral Chains attack control.
3. The E2E manual-release predicate is already true before Release is clicked
   and therefore does not verify removal.
4. The E2E does not exercise duplicate recurring-damage prevention.
5. Jest coverage and documentation do not catch or accurately describe those
   remaining behaviors.

## What Must Be Fixed

1. Update an existing Play Mode action-economy card/row rather than appending a
   new card on every slot toggle, and add a browser-level regression proving one
   card remains and all slot labels match shared state.
2. Preserve or reacquire the initiating attack-row control after the complete
   modal chain and focus it after the target modal is removed.
3. Make `releasePlayModeTarget()` verify that the target ID is absent after the
   click, and perform the manual-release probe on an active grapple or restraint
   so the test proves effect teardown and occupancy release.
4. Click normal recurring-damage resolution twice in the E2E, assert the second
   attempt is suppressed, then click Repeat and assert the explicit override
   resolves again.
5. Add regressions for the Play Mode duplication and focus-return failures, and
   correct the limitations/catalog claims only after those checks pass.
