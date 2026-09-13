# Inspector Feedback — Iteration 5

## Verdict: FAIL

## Acceptance Criteria Check

- [x] Gambler's Tools — verified by focused Jest and the normal/MEGA
  Playwright matrix: the card-set/dice-set proficiencies, three synthesized
  coin/dice/card attacks, and coin half-cover rider are present and
  source-qualified.
- [x] Gambler spellcasting — verified by focused progression/preparation tests
  and direct browser casting. A forced `1d6` Gambling Modifier roll of 4 was
  reused by both the same cast's attack (`4 + 6 = 10`) and save DC (`14`).
- [x] Gambler's Folly — exact wager tests pass. Direct browser casts verified
  result 49 preserved the slot and emitted no spell result, result 61 spent one
  slot and resumed exactly once after save/load with the original modifier, and
  result 33 emitted both the original spell and free PHB Color Spray while
  spending only the original slot.
- [ ] Extra Luck — FAILED: the production attack, save, ability-check, and
  skill-check paths all offered and spent the typed PB-scaled pool and bonus
  action in direct browser probes, and cancellation regression tests pass.
  However, the exported level-20 character contains two visible `Extra Luck`
  resources: an untyped feature-generated row and the typed
  `gamblerExtraLuck` row. Only the typed row is spent, leaving a misleading
  second pool.
- [x] Versatile Gambler — focused tests verify the level-13 transition to
  `3d6` prepared-spell dice and `2d4` cast modifier dice.
- [ ] Master of Fortune — FAILED: direct browser probing verified the natural-1
  offer, 1-to-20 intervention path, two d100 rolls, radio choice, durable
  save/load restoration, and application/expiry. The implementation also
  consumes the shared bonus action (`useMasterOfFortune()` calls
  `spendBonusAction()`), although the published feature has no bonus-action
  cost. This is an extra, non-canonical restriction.
- [ ] All 100 Gambling Table descriptors — FAILED: all IDs exist, but several
  published area effects remain incorrectly scoped or modeled. Examples
  include rows 6, 39, 43, 52, 59, 62, 73, and 88. Row 27 is worse: the
  15-foot-radius Silence centered on the Gambler is implemented as a self-only
  `Silenced` condition. These are not canonical descriptors and contradict the
  documented target/area boundary.
- [x] RNG seam — focused tests and browser probes used the per-sheet
  `setGamblerRollSource`/`setGamblerRollScenario` seam. The callback is not
  serialized, and production falls back to genuine randomness without a
  global `Math.random` test monkeypatch.
- [ ] Builder/LevelUp/QuickBuild/respec/rest/save-load/source gating — FAILED:
  a fresh same-name `Gambler|PHB` browser fixture correctly produced no Gambler
  identity, spell level, picker substitution, resources, tools, weapons, or
  spell rows. Tagged modifiers, active states, conditions, typed resources,
  receipts, and synthesized weapons were also removed on respec. However, the
  untyped feature-generated `Extra Luck` resource survived respec, so
  Gambler-only resource cleanup is incomplete.
- [ ] Accessible/responsive UI — FAILED: focus entered the modal, Escape
  restored the prior focus, the double-roll UI exposed a labelled native
  radiogroup, keyboard Space selected a result, and the status region used
  `role="status"`/`aria-live="polite"`. At a 360×640 viewport, however, the
  primary `Roll d100` button measured only about 120×28.9 CSS px rather than
  the required 44px height. Selecting a receipt choice through the radio also
  changed state to `ready` without rerendering the pending row from `Keep`
  controls to `Apply`; reopening the modal was required to expose `Apply`.
- [x] Targeted Jest and planted regressions — two focused suites passed all 117
  tests and seven related Character Sheet suites passed all 1,367 tests.
  Isolated plants for source gating, duration decrement/expiry, respec cleanup,
  post-result cancellation refund, and the initiative real-consumer path each
  caused the intended focused test failure.
- [ ] Playwright coverage and shared-helper gate — FAILED: the normal Gambler
  run passed 6 tests with 2 expected MEGA skips, and `RUN_MEGA=1` passed all 8
  tests. The spec still directly calls state APIs for `extraLuck` and
  `masterFortune`, and does not cover result 33, attack/save modifier reuse,
  all four fortune consumers, Master choice/apply/cancel/restore, expiry,
  respec cleanup, wrong-source gating, or accessibility/mobile behavior as
  deterministic real-effect browser probes. The required full TGTT/shared
  helper gate was attempted, but stopped as impractical after approximately
  74/383 tests had passed because projected runtime was several hours; its
  required passing result is therefore not established.
- [ ] Documentation and required artifacts — FAILED:
  `docs/charactersheet/gambler-rogue-support.md` incorrectly says all radius
  effects are area-scoped, Silence is a safe self effect, synthesized resources
  are fully cleaned up, and all choice/action controls meet 44px. The remaining
  defects are not recorded in `known-bugs.md`. The immutable
  `.goals/tgtt-gambler-rogue-support/goal.md` is also absent from the current
  branch and could only be recovered from an older checkpoint commit.

## Quality Gate

- Command:
  `npm run test:unit -- test/jest/charactersheet/CharacterSheetTGTTGambler.test.js test/jest/charactersheet/CharacterSheetTGTTGamblerEffects.test.js --no-coverage --forceExit`
  — **PASS** (2 suites, 117 tests).
- Command: related Character Sheet Jest selection — **PASS** (7 suites, 1,367
  tests).
- Command:
  `npx playwright test test/e2e/specs/tgtt-gambler-rogue-clairnian.spec.ts --reporter=list`
  — **PASS** (6 passed, 2 expected MEGA skips).
- Command:
  `RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-gambler-rogue-clairnian.spec.ts --reporter=list`
  — **PASS** (8 passed).
- Command:
  `RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-*.spec.ts --reporter=list --workers=2`
  — **INCOMPLETE** (stopped after about 74/383 passing because the projected
  runtime was several hours).
- Command: `npm run lint` — **PASS**.
- Command: `npm test` — **FAIL**. ESLint, full Jest (584 suites, 16,482 tests,
  208 skipped), and CSS checks passed, but the data `LinkCheck` failed on
  unresolved references in `data/bestiary/monstergroups.json` and
  `data/crafting.json`. The required repository gate is red even though those
  link failures are outside the latest Builder diff.

## Issues Found

1. **The mandatory repository gate is red.** `npm test` exits non-zero in
   `LinkCheck`, so the goal's final quality gate is not satisfied.
2. **The Gambling Table registry is not canonical.** Several radius/group rows
   are still assigned `self`, `target`, or `world` instead of `area`, and row
   27 incorrectly mutates only the Gambler with `Silenced`.
3. **Master of Fortune has an invented bonus-action cost.** Both
   `useMasterOfFortune()` and its receipt metadata use the shared bonus-action
   transaction even though the published level-17 feature only spends its
   PB-scaled long-rest use.
4. **Extra Luck is duplicated and cleanup is incomplete.** The real level-20
   export contains both an untyped `Extra Luck` row and a typed
   `gamblerExtraLuck` row. Respec cleanup removes only resources whose
   `resourceType` starts with `gambler`, leaving the untyped Gambler-only row.
5. **The result-choice UI is not fully compliant.** The `Roll d100` button is
   under 44px tall on mobile. A keyboard radio choice updates persisted state
   but does not rerender the receipt action row, so `Apply` appears only after
   reopening the modal or repeating the choice through the separate `Keep`
   button.
6. **The browser specification does not prove the stated surface.** Its fortune
   probes are state-level `page.evaluate` calls, not real consumer/UI flows,
   and many acceptance-critical behaviors remain absent from the spec. The
   shared-helper full TGTT gate has no completed passing run.
7. **Documentation overstates the implementation, and `goal.md` is missing.**
   The support document claims the known scope, cleanup, and touch-target
   defects are solved. The immutable goal artifact is not present in the
   current tree.

## What Must Be Fixed

1. Make `npm test` pass, including the data `LinkCheck`.
2. Audit all 100 published rows and correct every descriptor's scope and safe
   automation boundary, especially the remaining radius/group rows and row 27.
3. Remove the non-published bonus-action requirement from Master of Fortune
   while preserving atomic resource spending and cancellation semantics.
4. Deduplicate/migrate `Extra Luck` resources and remove every Gambler-owned
   resource on respec or TGTT disable without touching unrelated resources.
5. Give every modal action a 44px touch target and rerender receipt actions
   immediately after a radio choice so the keyboard path can proceed to Apply.
6. Extend the thin Gambler spec/page object with deterministic real-browser
   probes for every listed mechanic, then complete a passing full TGTT
   `RUN_MEGA=1` run because shared helpers were changed.
7. Correct the Gambler and known-bug documentation and restore the immutable
   `goal.md` artifact.
