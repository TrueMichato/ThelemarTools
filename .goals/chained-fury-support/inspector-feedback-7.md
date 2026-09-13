# Inspector Feedback — Iteration 7

## Verdict: PASS

Iteration 7 closes the four remaining failures from iteration 6 at their real
runtime gates. The implementation now keeps a single Play Mode **Your Turn**
card while slot controls update the shared action-economy state and visible
labels, restores focus to a connected control in the originating Spectral
Chains attack row after the real chained modal flow is cancelled, verifies
manual Release from an active grapple by requiring the target ID to disappear,
and exercises ordinary recurring-damage resolution twice before the explicit
Repeat override.

The complete diff since `4a84b403c9f0c5e2e091673859e8f5d2585c492c`
was reviewed. Previously accepted mechanics remain covered by the focused
state, combat, toggle, modal, progression, and E2E suites. No new unexplained
failures, skips, debug instrumentation, or documentation mismatches were found.

## Final Acceptance Criteria

- [x] Canonical level 3, 6, 10, and 14 Chained Fury values and mechanics match
  the TGTT data.
- [x] Spectral Chains is a real feature-granted attack gated by both Rage and
  Manifest Chains.
- [x] The real hit flow supports target-only, Grapple, Shove, Chain
  Imprisonment, and Chain Control outcomes.
- [x] Grapple/escape and Chain Imprisonment retain their distinct save
  contracts and DC calculations.
- [x] Size, range, capacity, same-target updates, stable IDs, persistence, and
  derived-state reconciliation are covered.
- [x] Recurring damage uses current Barbarian level, suppresses a second
  ordinary resolution in the same turn, and permits the explicit Repeat
  override.
- [x] Chained movement, drag cost, level-14 behavior, distribution,
  transactionality, and shared bonus-action use are covered.
- [x] Chain Control requires a successful grapple and a coherent 10-foot final
  position.
- [x] Escape, Release, out-of-range movement, active-state teardown, rest,
  level/source changes, and stale-load reconciliation clear effects and
  occupancy correctly.
- [x] Unchained Fury's three-attack allowance remains restricted to all-chain
  Attack actions.
- [x] Target-aware behavior remains generic and opt-in.
- [x] Combat and Play Mode expose one coherent target/action-economy state.
- [x] Modal accessibility, mobile layout, safe-area handling, and focus
  restoration meet the stated requirements.
- [x] Builder, LevelUp, and strict Quick Build ingest the subclass without an
  extra picker.
- [x] Focused Jest and E2E coverage exercise the implementation gates rather
  than relying on setup-only assertions.
- [x] Focused normal and `RUN_MEGA=1` Playwright runs pass with only the two
  expected non-MEGA skips in the normal run.
- [x] Relevant Character Sheet and E2E documentation accurately describes the
  verified behavior.

## Iteration 6 Failure Verification

1. **Play Mode action-economy card — fixed.** In a live browser, Action,
   Bonus, and Reaction were first spent. Repeated visible slot clicks
   (`Restore Bonus`, `Use Bonus`, then `Restore Reaction`) left exactly one
   `[data-pm-section="action-economy"]` card and one `.pm-economy` row after
   every click. Labels tracked shared state exactly:
   - after restoring Bonus:
     `Restore Action`, `Use Bonus`, `Restore Reaction`, `Use Movement`;
   - after spending Bonus again:
     `Restore Action`, `Restore Bonus`, `Restore Reaction`, `Use Movement`;
   - after restoring Reaction:
     `Restore Action`, `Restore Bonus`, `Use Reaction`, `Use Movement`.
   The corresponding shared states were `{false,true,false}`,
   `{false,false,false}`, and `{false,false,true}`.
2. **Target-modal focus — fixed.** A live level-11 character used the rendered
   Spectral Chains **Attack** control, confirmed **Hit**, selected **Chain
   Imprisonment**, opened the real target form, and clicked **Cancel**. After
   teardown, `document.activeElement` was the connected
   `.charsheet__attack-roll` button inside the Spectral Chains attack row, not
   `BODY` or a global fallback.
3. **Manual Release E2E — fixed.** The lifecycle now creates **Manual release**
   through the real Grapple rider with a failing target save, then clicks the
   visible Play Mode Release control. `releasePlayModeTarget()` succeeds only
   when no record with that target ID remains. The passing USE test therefore
   proves both an active grapple precondition and complete target removal.
4. **Recurring-damage E2E — fixed.** The lifecycle clicks the ordinary
   recurring-damage control, records the resolved turn, clicks the ordinary
   control again, requires the visible “already resolved” feedback, and proves
   the stored ordinary-resolution turn did not change. It then clicks
   **Repeat** and verifies the explicit repeat marker matches that turn.

## Browser Verification

- Spawned `barbarian/chained fury/11/minotaur` through the real spawn/Quick
  Build pipeline.
- Verified the action-economy card count, row count, labels, and shared state
  after multiple real Play Mode slot clicks.
- Verified the full Spectral Chains → Hit → Chain Imprisonment → target modal
  → Cancel focus path.
- Browser console reported zero errors during the manual verification.

## Quality Gate

- `npm run test:unit -- CharacterSheetChainedFury CharacterSheetTargetEffects CharacterSheetCombat CharacterSheetToggleAbilities --no-coverage --forceExit`
  - **PASS** — 26 suites, 792 tests.
- Focused ESLint over all changed Character Sheet and related Jest JavaScript
  files
  - **PASS**.
- `npm run test:css`
  - **PASS**.
- `npm run spawn -- "barbarian/chained fury/3/minotaur" --strict`
  - **PASS** — Barbarian 3 / Path of the Chained Fury, with no unresolved
    choices or unhandled prompts.
- `PW_PORT=9077 npx playwright test test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts --reporter=list --workers=1`
  - **PASS** — 6 passed, 2 expected MEGA skips.
- `PW_PORT=9078 RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts --reporter=list --workers=1`
  - **PASS** — all 8 tests, including both MEGA walks and the lifecycle USE
    test.

## Hygiene and Documentation

- No added `console.log`, `console.debug`, `console.info`, `debugger`,
  `E2E-DUMP`, or `PWDEBUG` instrumentation exists in the implementation diff.
- `docs/e2e/test-suite-catalog.md` accurately describes the exercised
  duplicate/repeat damage checks and Play Mode Escape/Release paths.
- `docs/charactersheet/10-known-limitations.md` accurately describes the
  verified Spectral Chains focus restoration.
- `git diff --check` reports only historical trailing blank lines in immutable
  goal/earlier-feedback files, not a product-code defect introduced by
  iteration 7.

