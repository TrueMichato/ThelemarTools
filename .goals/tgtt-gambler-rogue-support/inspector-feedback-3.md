# Inspector Feedback — Iteration 3

## Verdict: FAIL

The Builder substantially improved the Gambler implementation and the dedicated
Gambler test commands are green. Independent runtime verification nevertheless
found multiple acceptance-critical defects. In particular, result 49 still
executes the spell it says has failed, result 61 never executes the delayed
spell after Resume, several supposedly automatic table effects are inert or
incorrect, a same-name non-TGTT subclass still receives Gambler spell access,
restored Master of Fortune receipts falsely report completion without applying
the selected result, and an exhausted fortune pool consumes the shared bonus
action despite returning failure.

## Acceptance Criteria Check

- [ ] **1. Core subclass progression is complete and correct** — FAILED:
  level-gated feature/resource detection and the Gambler spell-list choice
  machinery pass the dedicated tests, but spell access is not completely
  source-gated. A browser-runtime probe using a PHB Rogue with a PHB subclass
  named `Gambler` returned a maximum spell level of 1. The leak is in
  `CharacterSheetSpells._getMaxSpellLevel()`, whose `thirdCasters` list still
  matches the subclass by name alone. Therefore a wrong-source same-name
  subclass can receive Gambler spell-picker access.

- [x] **2. Gambling Die progression is deterministic and shared** — verified:
  the runtime uses one canonical progression helper and the targeted tests
  validate 1d4/2d4/3d4 at levels 3/9/17. A planted regression changing the
  level-9 die back to 1d6 made the targeted suite fail.

- [x] **3. The level-3 skill-risk feature is implemented** — verified:
  the skill-risk state methods, failure condition, duration, recovery, and
  persistence tests pass. The implementation uses character-state APIs and the
  shared Gambling Die helper rather than page-local fields.

- [ ] **4. The level-3 risky casting path is complete and deterministic** —
  FAILED:
  a real browser cast of PHB `Ray of Sickness` confirmed the good part: one
  injected Gambling Modifier value of 4 was reused by the actual attack output
  and actual save-DC output. The d100 lifecycle is still incorrect, however:

  - With forced result 49, slot preservation worked, but
    `_showCastResult()` was called once and the spell's output was produced.
    The canonical result says the spell fails, so this is not atomic.
  - With forced result 61, the initial cast was deferred and the slot was
    consumed, but explicit Resume caused zero `_showCastResult()` calls.
    `resumeGamblerDelayedCast()` only changes receipt status to `ready`, after
    which the modal commits/removes the receipt; no code executes the stored
    spell.
  - The successful dedicated Playwright probes do not catch either defect
    because `probeGamblerFlow()` calls state APIs directly through
    `page.evaluate()` instead of performing a real cast and inspecting the
    resulting output and slot state.

- [ ] **5. The canonical d100 table is implemented end to end** — FAILED:
  all 100 result descriptors exist, and selection/chosen-index persistence is
  present, but faithful mechanical implementation is not complete. Independent
  state/runtime probes found:

  - Row 5 emits no Light state despite existing emitted-light infrastructure.
    It is represented only as a note.
  - Row 13 emits unsupported `sizeChange` data and incorrectly adds a
    half-speed penalty that the canonical Reduce effect does not specify.
  - Row 20 also emits unsupported size-change data. Its initiative/speed
    consumers exist, but removing the initiative consumer still left all 109
    targeted Gambler tests green.
  - Row 25 stores `senseType: "xray"` while the active-state sense consumer
    reads `target`; the X-ray effect is therefore unusable.
  - Rows 22 and 27 are note-only active states rather than modeled levitation
    and silence effects.

  The registry reports 85 manual, 13 automatic, and 2 confirmation results.
  Manual fallback is acceptable for irreducible narrative results, but it does
  not satisfy the requirement that safe self-contained mechanical effects use
  the active-state layer, especially where a supported generic mechanism
  already exists.

- [ ] **6. Higher-level Gambler features are complete** — FAILED:
  proficiency-bonus resources, long-rest reset, save/load, Master of Fortune
  double-roll choice, and the basic shared bonus-action flag are present.
  Resource/action spending is not atomic. An independent Jest probe exhausted
  Extra Luck, reset the bonus action, called `useExtraLuck()`, and observed the
  method return `false` while `isBonusActionAvailable()` changed to `false`.
  `useMasterOfFortune()` has the same spend-bonus-action-before-resource
  ordering. This violates the explicit requirement that exhausted/failed
  attempts spend nothing. The standard exhausted-pool test misses the bug
  because it does not reset and then assert the bonus-action state.

- [ ] **7. Resolution lifecycle, persistence, and cleanup are safe** — FAILED:
  receipt serialization and basic cleanup methods exist, but the restored
  lifecycle is not functional end to end. In a real browser restored-receipt
  probe, choosing result 9 left the receipt in `ready`, did not apply Prone,
  removed the choice buttons, and displayed `Resolution committed.` The user
  must close and reopen the modal to discover another Apply step. Result 61
  also commits a resumed receipt without executing its stored delayed spell.
  These are unresolved or falsely reported states, not safe resolution.

- [ ] **8. TGTT behavior is source-safe and local-only** — FAILED:
  several identity helpers were improved to require TGTT source/class context,
  but the spell-level consumer above still grants access to a wrong-source
  same-name subclass. Consequently not every runtime source-gating consumer is
  correct.

- [ ] **9. Tests prove the real browser behavior and catch regressions** —
  FAILED:

  - Targeted Gambler Jest: **PASS**, 2 suites / 109 tests.
  - Related Character Sheet Jest: **PASS**, 9 suites / 263 tests.
  - Normal Gambler Playwright: **PASS**, 6 passed / 2 MEGA-only skipped.
  - `RUN_MEGA=1` Gambler Playwright: **PASS**, 8 passed.
  - Planted Gambling Die, row-49 descriptor, and Extra Luck bonus-action
    regressions failed tests as expected.
  - Removing the production initiative active-state consumer used by row 20
    did **not** fail any of the 109 targeted Gambler tests.
  - The new Playwright probe directly invokes state methods and never proves
    real cast output, actual slot mutation, delayed-spell execution, or full
    restored-receipt application.
  - The repository contains 47 TGTT spec files. The complete normal+MEGA TGTT
    matrix was not practical to rerun after the required dedicated normal and
    MEGA runs and independent browser probes; the mandatory full shared-helper
    gate is therefore not established.

- [ ] **10. Code quality and accessibility are maintained** — FAILED:
  the restored modal exposes a role-accessible heading and native buttons,
  keyboard activation worked, and no horizontal page overflow was observed at
  360×640. Those presentation checks do not compensate for the modal's false
  committed state and dead-end flow. Repository lint also fails, so the
  required quality baseline is not green.

- [ ] **11. Documentation is accurate and current** — FAILED:
  the new document explains the architecture and limitations, but it overstates
  that delayed casts can be resumed, that restored receipt resolution is safe,
  and that canonical safe effects are implemented. Those claims contradict the
  observed runtime behavior above.

## Quality Gate

- Command: targeted Gambler Jest suites
  - Result: **PASS**
  - Details: 2 suites, 109 tests.
- Command: related Character Sheet Jest suites
  - Result: **PASS**
  - Details: 9 suites, 263 tests.
- Command:
  `npx playwright test test/e2e/specs/tgtt-gambler-rogue-clairnian.spec.ts`
  - Result: **PASS**
  - Details: 6 passed, 2 MEGA-only skipped; approximately 2.4 minutes.
- Command:
  `RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-gambler-rogue-clairnian.spec.ts`
  - Result: **PASS**
  - Details: 8 passed; approximately 4.5 minutes.
- Command: strict E2E audit
  - Result: **FAIL**
  - Details: Gambler reports FULL/111%, but 13 repository specs remain below the
    strict threshold.
- Command: `npm run lint`
  - Result: **FAIL**
  - Details: 7 ESLint errors in pre-existing/unrelated bestiary quick-action
    files.
- Command: `npm test`
  - Result: **FAIL**
  - Details: stopped in `test:js` with 14 ESLint errors in
    pre-existing/unrelated bestiary quick-action and attachment-corpus files.
- Command: `git diff --check HEAD~1`
  - Result: **PASS**

The unrelated origin of the repository lint failures is recorded, but the goal
explicitly requires the final lint/full-test gates to be green, so they remain
blocking quality-gate failures.

## Planted-Failure and Independent Runtime Checks

- Changed the level-9 Gambling Die formula to 1d6: targeted tests failed as
  expected.
- Changed result 49 away from `preserveSlot`: targeted tests failed as
  expected.
- Reintroduced the Extra Luck caller bypass for bonus-action cost: targeted
  tests failed as expected.
- Removed the production initiative modifier consumer used by row 20: all 109
  targeted Gambler tests still passed, demonstrating a regression-coverage
  hole.
- Real browser forced result 49: the slot was preserved, but spell output still
  executed once.
- Real browser forced result 61: explicit Resume produced no spell output.
- Real browser Ray of Sickness cast: one Gambling Modifier roll was reused for
  both attack and save DC, as required.
- Restored Master of Fortune choice: keyboard-accessible selection falsely
  reported completion while leaving the receipt ready and the effect unapplied.
- Exhausted Extra Luck with a fresh bonus action: the failed attempt consumed
  the bonus action.

All temporary probe files and planted production changes were removed before
writing this report.

## Issues Found

1. **Result 49 is not an atomic failed cast.** Slot preservation does not stop
   the original spell from reaching `_showCastResult()`.
2. **Result 61 cannot actually resume.** Receipt state advances and is removed,
   but the serialized spell is never executed.
3. **Canonical automatic table effects are incomplete or malformed.** Rows 5,
   13, 20, 22, 25, and 27 provide concrete counterexamples.
4. **Wrong-source same-name subclasses receive spell access.**
   `_getMaxSpellLevel()` still performs name-only `Gambler` matching.
5. **Fortune feature spending is non-atomic.** An exhausted pool can consume
   the shared bonus action before resource spending fails.
6. **Restored Master of Fortune choice has a misleading dead end.** It claims
   commitment without applying the chosen result and leaves the receipt ready.
7. **Regression tests do not exercise the real feature lifecycle.** Direct
   state-method probes can pass while real cast output, delayed execution, and
   active-state consumers are broken.
8. **Documentation describes behavior that is not implemented.**
9. **Required repository quality gates are red.**

## What Must Be Fixed

1. Make cast resolution atomic:
   - result 49 must prevent spell output/effects while preserving the slot;
   - result 61 must persist enough cast context to execute the exact delayed
     spell once on Resume, without rerolling the modifier or d100 and without
     double-spending a slot.
2. Replace name-only Gambler logic in `_getMaxSpellLevel()` with canonical
   TGTT Rogue/Gambler identity checks and add wrong-source tests for the actual
   spell-level picker consumer.
3. Audit all 100 canonical rows against the source text. Model every safe,
   supported mechanical effect through active-state APIs; remove invented
   mechanics; fix descriptor fields to match their consumers; and add effect
   and expiry tests for each automatic row.
4. Make Extra Luck and Master of Fortune spend the resource and shared bonus
   action transactionally. Exhausted, unavailable, cancelled, or failed calls
   must leave both unchanged.
5. Complete restored receipt choices in one coherent interaction: choosing an
   outcome must immediately apply/confirm the chosen result or clearly present
   the required next step. Never display `Resolution committed.` while the
   receipt remains ready and unapplied.
6. Replace or supplement direct `page.evaluate()` probes with browser tests
   that drive the actual cast UI, assert slot counts and rendered output, resume
   delayed casts, restore/reopen receipts, apply canonical effects, and verify
   cleanup after respec/load.
7. Add planted coverage for real runtime consumers, including initiative,
   speed, light, sense, conditions, delayed execution, wrong-source spell
   access, and exhausted-resource action atomicity.
8. Correct the documentation after the implementation matches observable
   behavior.
9. Restore all mandated repository gates to green and run the full TGTT suite
   required by the shared-helper/page-object change.
