# Inspector Feedback — Iteration 4

## Verdict: FAIL

The Builder fixed the previously reported result-49, result-61, restored-receipt,
wrong-source runtime, and exhausted-resource defects. The dedicated Gambler
commands, the full TGTT MEGA run, and lint are now green. Independent browser and
state verification still found acceptance-critical gaps: automatic effects do
not honor their published expiry, applied effects survive Gambler removal,
descriptor scopes are not canonical, cancelling a fortune-created confirmation
can refund the resource and bonus action after the d20 result has already been
changed, the required accessible/mobile interaction is absent, and the browser
tests do not exercise the real cast and receipt behaviors they claim to cover.
The final `npm test` gate also remains red.

## Acceptance Criteria Check

- [x] **Gambler's Tools grants the required proficiencies and attacks without
  leaking** — verified:
  targeted Jest covers Playing Card Set and Dice Set proficiency, the coin,
  dice, and card attacks, and the coin half-cover rider. Direct source-removal
  checks confirm the synthesized weapons/resources are removed when the
  character is no longer a valid TGTT Gambler.

- [x] **Gambler spellcasting uses the published progression and one
  cast-scoped Gambling Modifier** — verified:
  targeted progression tests pass for cantrips, slots, prepared allowance, and
  the level-13 dice upgrade. A real Ray of Sickness cast previously verified
  that the same injected modifier is used by both the attack output and save
  DC. Result-61 persistence verification also showed that Resume reused the
  original serialized modifier rather than rerolling it.

- [x] **Gambler's Folly uses the correct wager odds and handles result 49
  atomically** — verified:
  the rules tests cover the level 1–4 wager dice/losing faces. In a direct
  browser cast with forced result 49, the slot remained `3 -> 3`,
  `_showCastResult()` was never called, concentration was not started, and the
  committed receipt recorded the preserve-slot transaction. A planted
  `preserve -> consume` violation made the focused test fail.

- [ ] **Extra Luck works transactionally on all required d20 paths** —
  FAILED:
  attack/save/ability/skill hooks and the PB-scaled pool are covered, and
  independent exhausted-pool probes now return `false` without consuming a
  fresh bonus action. However, the overall intervention transaction can still
  be made free. A Master intervention changed a natural 1 to 20 and returned
  the changed result to the caller; choosing a confirmation row and cancelling
  its receipt then restored both the Master use and bonus action. The already
  returned natural 20 cannot be rolled back. The same fire-and-forget table
  resolution architecture applies to fortune interventions generally, so
  cancellation is not atomic with the d20 mutation.

- [x] **Versatile Gambler changes the prepared and modifier dice at level
  13** — verified:
  targeted Jest passes for `3d6` daily preparation and `2d4` cast modifiers.

- [ ] **Master of Fortune fully preserves a correct transactional lifecycle** —
  FAILED:
  the natural-1-to-20 mutation, downstream critical-state recomputation,
  PB-scaled resource, two table rolls, required choice, and save/load of the
  unresolved choice are implemented. Restored choice/application also works in
  the current UI. The cancellation defect above nevertheless permits a
  no-cost natural 20: the state returned `naturalRoll: 20`, then cancellation
  restored the resource from 5 to 6 and made the bonus action available while
  deleting the pending receipt.

- [ ] **All 100 canonical table rows have faithful explicit descriptors and
  safe effects use canonical state systems** — FAILED:
  all 100 numeric keys exist and manual outcomes remain durable, but the
  descriptors and automatic lifecycles are not complete.
  - The registry contains 45 `self`, 37 `target`, and 18 `world` rows, but zero
    `area` rows. Canonical area effects such as row 18 (all within 60 feet),
    row 23 (60-foot Cause Fear), row 42 (all magical weapons within 30 feet),
    and row 45 (all creatures within 30 feet) are classified as `self`.
  - Row 10's one-round Blinded condition remained after ten combat rounds.
    Conditions are added without table-owned duration metadata or expiry.
  - Row 4's one-hour initiative modifier applies (`2 -> 0`) but has no expiry
    path.
  - Dice durations are parsed as fixed maxima rather than rolled:
    `1d6 rounds` becomes 6 rounds, `1d3 minutes` becomes 30 rounds, and
    `1d4 minutes` becomes 40 rounds.
  - The state API described by the approved plan for recording a manual
    resolution as a note is absent; only acknowledgement is implemented.

- [x] **Randomness uses a per-sheet injectable seam without global
  `Math.random` replacement** — verified:
  prepared dice, modifier dice, wager, d100, and intervention rerolls use the
  sheet RNG provider with production randomness as the fallback. The tests use
  the seam rather than globally replacing `Math.random`.

- [ ] **Builder/LevelUp/QuickBuild, respec, rest, save/load, and source gating
  remain consistent with cleanup** — FAILED:
  direct runtime probes now correctly reject a PHB Rogue with a same-name PHB
  `Gambler` subclass and also reject a valid TGTT Gambler while TGTT is
  disabled: max spell level, prepared allowance, pending cantrips, spell
  attribution, tools, and resources all remained inactive. Receipt/resource
  save/load and rest tests pass. Cleanup is still incomplete, however. After
  changing a valid TGTT Gambler to PHB and reconciling, a row-4 named
  initiative modifier, row-5 Light active state, and row-9 Prone condition all
  survived. `_cleanupGamblerArtifacts()` removes weapons, resources, receipts,
  and history, but not table-owned conditions, modifiers, or active states.

- [ ] **All UI states are accessible, responsive, and usable on mobile** —
  FAILED:
  a restored Master receipt can now be selected and applied without reopening
  the modal, and the 360×640 probe found no horizontal document overflow.
  Required interaction semantics are still absent:
  - the two-result choice is ordinary buttons, not a radio/radiogroup;
  - no `aria-live="polite"` region announces rolled values or status;
  - focus remains on `BODY` when the dialog opens instead of entering the
    title or first choice;
  - mobile choice controls are about 29 px high, below the required 44 px
    target.

- [ ] **Targeted Jest asserts real effects and is proven red by planted
  violations** — FAILED:
  112 focused Gambler tests and 596 related Character Sheet tests pass.
  Planted changes to result 49 and the row-20 initiative effect failed as
  expected. A planted regression that removed the real source guard from
  `CharacterSheetSpells._getMaxSpellLevel()` and restored name-only Gambler
  matching still left all 184 selected Gambler/spell tests green. There are
  also no focused regressions for automatic-effect expiry or removal of
  already-applied table effects during respec.

- [ ] **The Gambler Playwright spec covers every measurable feature with
  deterministic real-effect probes, and shared gates pass** — FAILED:
  the dedicated normal run passed 6 tests with 2 expected MEGA skips, the
  `RUN_MEGA=1` run passed all 8 tests, and the full TGTT MEGA run passed 337
  tests with 26 skips. Those green commands do not satisfy the coverage part
  of the criterion:
  - the new `ui` probe clicks the first available spell and only looks for any
    `/cast /i` toast; at L3 this may be a cantrip and need not run Gambler's
    Folly;
  - the remaining Gambler probes continue to call state APIs via
    `page.evaluate()`;
  - no Playwright assertion forces and verifies result 49's output/slot
    behavior, result 61's persisted resume and no-double-spend behavior,
    cast-scoped modifier reuse in rendered output, all four real intervention
    paths, restored effect application, effect expiry, or respec cleanup.
  The strict audit labels the spec FULL/111%, but also reports its
  `extraLuckUses` and `masterOfFortuneUses` probes as write-only calculations,
  confirming that the numerical audit is not proof of real UI behavior.

- [ ] **Related documentation is complete and accurate** — FAILED:
  across the goal branch only `CHARACTERSHEET_TEST_AUDIT.md`,
  `docs/e2e/comprehensive-test-standard.md`, and
  `docs/charactersheet/gambler-rogue-support.md` changed. The architecture,
  feature-calculation, subsystem, testing-guide, development-status, TGTT
  integration, and known-bug references named by the approved plan were not
  reconciled. The Gambler document's claim that safe effects use canonical
  duration/removal systems is inaccurate given the expiry and respec results
  above.

## Quality Gate

- Command:
  `npm run test:unit -- test/jest/charactersheet/CharacterSheetTGTTGambler.test.js test/jest/charactersheet/CharacterSheetTGTTGamblerEffects.test.js --no-coverage --forceExit`
  - Result: **PASS**
  - Details: 2 suites, 112 tests passed.
- Command: related Character Sheet Jest batch
  - Result: **PASS**
  - Details: 10 suites, 596 tests passed.
- Planted failure: result 49 `preserve` changed to `consume`
  - Result: **PASS**
  - Details: the focused test failed as expected.
- Planted failure: remove row-20 initiative effect
  - Result: **PASS**
  - Details: the focused runtime-consumer test failed as expected.
- Planted failure: restore name-only `_getMaxSpellLevel()` behavior
  - Result: **FAIL**
  - Details: 3 suites / 184 tests remained green, exposing an unprotected
    production source-gating consumer.
- Command:
  `npx playwright test test/e2e/specs/tgtt-gambler-rogue-clairnian.spec.ts --reporter=list`
  - Result: **PASS**
  - Details: 6 passed, 2 MEGA-only skipped; approximately 4.6 minutes.
- Command:
  `RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-gambler-rogue-clairnian.spec.ts --reporter=list`
  - Result: **PASS**
  - Details: 8 passed; approximately 10.1 minutes.
- Command:
  `RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-*.spec.ts --reporter=list --workers=2`
  - Result: **PASS**
  - Details: 337 passed, 26 skipped; approximately 27.1 minutes.
- Command: `node scripts/auditE2eCoverage.mjs --strict`
  - Result: **FAIL overall**
  - Details: Gambler reports FULL/111%, while 13 repository specs remain below
    threshold; the audit also identifies two Gambler write-only calculation
    probes.
- Command: `npm run lint`
  - Result: **PASS**
- Command: `npm test`
  - Result: **FAIL**
  - Details: all 114 Jest suites / 7,431 tests passed, then
    `docs:known-bugs:check` failed because the repository count is 114 while
    the configured threshold is 111. This is a required final gate.
- Command: `git diff --check HEAD~1`
  - Result: **PASS**

## Direct Runtime and Browser Verification

- Forced result 49 on canonical PHB Ray of Sickness: no slot spend, no spell
  output, no concentration, committed preserve-slot receipt.
- Forced result 61: initial slot `3 -> 2`, initial output deferred, receipt
  survived save/load with spell/slot/modifier, Resume emitted the original
  spell once with the original modifier, no second slot spend, and committed
  the receipt.
- Forced result 33: the original spell and canonical PHB Color Spray each
  emitted once, while only the original spell consumed a slot.
- Restored Master receipt with rolls 9/88: selecting 9 immediately exposed
  Apply, applying added Prone, removed the receipt, and committed history with
  chosen roll 9.
- Exhausted Extra Luck and Master pools: failed attempts preserved a fresh
  bonus action.
- Fortune cancellation exploit: Master returned an applied natural 20, then
  cancelling its selected confirmation receipt restored the use and bonus
  action while removing the receipt.
- Automatic-effect expiry: one-round Blinded survived ten rounds; random
  duration strings became fixed maxima.
- Respec cleanup: table-owned initiative, Light, and Prone effects survived
  removal of the TGTT Gambler source.
- Mobile/accessibility: no horizontal overflow at 360×640, but no initial
  focus, radio semantics, live region, or 44 px controls.

## Issues Found

1. **Automatic table effects do not have faithful duration lifecycle.**
   Conditions and named modifiers do not expire, and dice durations use a
   numeric-suffix parser rather than the injectable RNG.
2. **Applied Gambler effects survive source removal/respec.** Cleanup does not
   own or remove table-created conditions, modifiers, or active states.
3. **Canonical descriptor classification is incorrect.** No descriptor uses
   the required `area` scope despite multiple explicit area results.
4. **Fortune cancellation can create a free modified roll.** Receipt
   cancellation refunds the use/action after the changed natural result has
   already been returned to the caller.
5. **The required accessibility/mobile design is not implemented.** Choice
   semantics, announcements, focus management, and touch-target size fail
   direct inspection.
6. **Regression and E2E coverage can stay green while real consumers break.**
   The wrong-source spell-level plant was not detected, and passing Playwright
   rows do not exercise the acceptance-critical cast/receipt/effect flows.
7. **Documentation is incomplete and overstates effect lifecycle support.**
8. **The required final repository test gate is red.**

## What Must Be Fixed

1. Give every automatic condition, modifier, and active state a table-owned,
   persisted expiry. Roll `1dN` durations through the sheet RNG seam instead of
   parsing the maximum face value, and test expiry at exact round/time
   boundaries.
2. Track all applied Gambling Table artifacts by Gambler source/resolution and
   remove them when TGTT is disabled, the subclass/source changes, or the
   granting level is lost.
3. Audit all 100 descriptors against the canonical text, assign correct
   self/target/area/world scopes, and add the durable record-as-note path
   specified by the approved plan.
4. Make fortune intervention and table resolution one transaction: do not
   expose the changed d20 result until required choice/confirmation is
   committed, or do not allow a later cancellation to refund an already-used
   intervention.
5. Implement radio-group semantics, polite live announcements, dialog
   entry/return focus, and 44 px mobile targets, then cover them in browser
   tests.
6. Replace the weak cast-toast/direct-state Playwright checks with page-object
   flows that cast real spells, inspect rendered output and slot/action/resource
   state, persist/resume receipts, apply/expire effects, and verify cleanup.
7. Add planted-failure gates for `_getMaxSpellLevel()`, duration consumers,
   effect cleanup, restored application, and the fortune cancellation path.
8. Reconcile all architecture/TGTT/testing/known-bug documentation and restore
   `npm test` to green.
