# Inspector Feedback — Iteration 1

## Verdict: FAIL

## Acceptance Criteria Check

- [ ] Gambler's Tools grants card-set and dice-set proficiency, creates correct coin/dice/card attacks, and applies the coin half-cover rider without leaking to other characters.
  - The targeted tests verify the three equipped attacks and the coin rider.
  - **FAILED:** the feature calculation is selected by subclass name alone (`case "Gambler"`), without requiring TGTT class/subclass source. A same-named non-TGTT subclass receives the mechanics.
  - **FAILED:** `_injectGamblerWeapons()` is add-only. Removing/respeccing away from Gambler clears some Gambler state but does not remove the injected weapons, so subclass-owned items can remain on the character.
- [ ] Gambler spellcasting uses the exact published cantrip and slot progression, rolls the correct daily prepared-spell allowance, and rolls one cast-scoped Gambling Modifier reused across every attack/save produced by that cast.
  - The published cantrip and slot tables and prepared/modifier dice are covered by passing Jest assertions.
  - **FAILED:** there is no end-to-end assertion proving that one actual cast reuses one modifier across all attack/save output. The new receipt test calls the state API directly and never exercises the spell-cast UI or slot pipeline.
  - **FAILED:** unresolved cast receipts are not integrated with a user resolution flow, so the cast pipeline can finish while its receipt remains pending.
- [ ] Gambler's Folly uses exact wager odds for spell levels 1-4, triggers the Gambling Table on a loss, and handles slot/cast overrides such as result 49 atomically.
  - Wager odds and direct state receipt construction pass.
  - **FAILED:** Master of Fortune cast receipts decide `descriptor` and `slotTransaction` from the first roll before the required choice. Slot consumption is therefore decided before the player selects either result.
  - **FAILED:** confirmation/choice receipts are allowed to proceed through the spell cast; `commitGamblerCastResolution()` then returns `null` and leaves them pending. Result 61 does not delay the cast, and result 33 does not cast Color Spray.
  - The result-49 test only inspects a direct state receipt. It does not prove real spell-slot mutation/refund or cancellation behavior.
- [ ] Extra Luck works on attack rolls, saving throws, ability checks, and skill checks; atomically spends its PB-scaled long-rest resource and required bonus action; and spends nothing when declined or cancelled.
  - Attack/check/save hooks and PB-scaled resource behavior exist.
  - **FAILED:** the added `actionEconomy.bonusActionAvailable` state is separate from Play Mode's existing `_actionEconomy`. It is reset only on long rest, not on “Reset turn,” so after one accepted Extra Luck use it remains unavailable until a long rest.
  - `useExtraLuck()` defaults to `consumeBonusAction: false`, allowing direct callers to spend the feature without its required bonus action.
  - No regression test covers declining/cancelling the actual prompt or the four real UI roll paths.
- [x] Versatile Gambler changes prepared-spell dice to 3d6 and Gambling Modifier dice to 2d4 at Rogue level 13.
  - Verified by targeted Jest tests. A planted state-layer regression changing the modifier back to `1d6` made the focused test fail.
- [ ] Master of Fortune changes a natural 1 to a natural 20, updates downstream critical/fumble interpretation, rolls twice on the Gambling Table, requires a player choice, spends its PB-scaled long-rest resource, and preserves unresolved/resolved choices across save/load.
  - The generic intervention mutates the roll result, and direct state tests cover the resource, double roll, choice, and basic save/load.
  - **FAILED:** a Gambling Table roll created inside a spell receipt has no production caller for `chooseGamblerTableResult`, `applyGamblingTableResolution`, or `acknowledgeGamblingTableResolution`. The existing modal updates only `gamblerLastTableRoll`, not the pending cast receipt.
  - Thus cast-scoped unresolved choices cannot be completed, applied, or committed through the UI.
- [ ] Every one of the 100 canonical Gambling Table rows has an explicit implementation descriptor. Safe self/spell effects use existing active-state, condition, modifier, resource, and spell transaction systems; target/world/DM-adjudicated effects remain explicit durable manual resolutions with no silent no-op.
  - All 100 rows receive an object, but this is mostly a numbered fallback rather than a complete implementation.
  - **FAILED:** 93 rows are classified as manual. Only rows 9, 10, 32, 49, and 99 are automatic, and only 33/61 are confirmation descriptors.
  - Safe self effects such as row 2 (Persuasion disadvantage), row 4 (initiative penalty), row 5 (Light), row 13 (Reduce), row 20 (speed/initiative penalties), row 22 (levitation), row 25 (X-ray vision), and row 27 (Silence) are not implemented through active state/modifier/spell systems.
  - `applyGamblingTableResolution()` only applies conditions; “confirm” and manual rows are merely marked acknowledged. The documented spell transactions for rows 33 and 61 are not executed.
- [x] All Gambler randomness uses a per-sheet injectable RNG seam in tests and genuine production randomness otherwise; tests do not globally monkeypatch Math.random.
  - Prepared dice, modifier, wager, table, and Extra Luck reroll paths use the per-sheet source with `Math.random` fallback. Updated tests no longer monkeypatch global randomness.
- [ ] Builder, LevelUp, QuickBuild, respec, rest, save/load, and TGTT source gating produce consistent level-correct behavior with backward-compatible defaults and cleanup.
  - Defaults and basic receipt/resource save/load are present.
  - **FAILED:** TGTT source gating is missing for the `Gambler` subclass-name branch.
  - **FAILED:** respec cleanup does not remove injected Gambler weapons.
  - **FAILED:** QuickBuild/respec and restored pending-flow behavior are not covered by new tests.
  - Bonus-action state is not connected to the existing turn-reset UI.
- [ ] Wager, prepared-spell, fortune-intervention, result-choice, resource, confirmation, error, pending, and restored states follow the existing Character Sheet design system and are keyboard-accessible, screen-reader-legible, responsive, and usable on mobile.
  - **FAILED:** no UI/CSS/page-object work was committed for pending/restored cast receipts, confirmations, acknowledgements, errors, or manual-resolution instructions.
  - The new durable receipt APIs are not rendered anywhere. Existing Gambling Table UI can choose only the global last roll and cannot resolve the new pending cast records.
  - No mobile, keyboard, screen-reader, or restored-state browser assertions were added.
- [ ] Targeted Jest tests assert real state/effect changes and are demonstrated to fail against planted violations before final validation.
  - The targeted suites pass, and planted changes to the live state calculation and result-49 transaction were caught.
  - **FAILED:** the new 100-row test checks only object count/id/automation enum, not canonical row semantics or effects.
  - A planted violation in the new `CharacterSheetGamblerRules.getModifierDice()` helper still passed the purported Versatile Gambler regression test, exposing duplicated rules and an untested helper path.
  - No tests call `applyGamblingTableResolution()` or exercise confirmation/manual resolution effects.
- [ ] The Gambler Playwright spec covers every measurable subclass feature with deterministic real-effect probes and passes normally and with `RUN_MEGA=1`; shared E2E helper changes pass the full TGTT suite.
  - **FAILED:** the Builder commit did not update the Gambler spec or add deterministic receipt/UI probes. Existing state calls roll nondeterministically and do not cover actual result 49 slot behavior, pending confirmations, manual resolution, restored choices, Extra Luck cancellation, or per-cast modifier reuse.
  - The required normal Playwright command failed: 5 passed, 2 skipped, 1 failed (`USE` timed out in `beforeEach`).
  - The required `RUN_MEGA=1` command failed: 3 passed, 5 failed after the web server became unavailable.
  - A serial diagnostic run completed the MEGA feature matrix but still failed 2 tests with `ERR_CONNECTION_REFUSED`.
- [ ] Related Character Sheet, TGTT, testing, E2E, audit, and known-bug documentation is updated.
  - **FAILED:** only `docs/charactersheet/gambler-rogue-support.md` was added. Testing/E2E/audit/reference documentation was not updated for the new receipt/effect APIs.
  - The new document overstates implementation by claiming safe self effects use existing systems when most safe self rows are manual acknowledgements.

## Quality Gate

- Command: `npm run test:unit -- test/jest/charactersheet/CharacterSheetTGTTGambler.test.js test/jest/charactersheet/CharacterSheetTGTTGamblerEffects.test.js --no-coverage --forceExit`
  - Result: PASS
  - Details: 2 suites, 89 tests passed.
- Planted failure: force live L13 Gambling Modifier to `1d6`
  - Result: PASS (the test failed as expected).
- Planted failure: change result 49 transaction from `preserveSlot`
  - Result: PASS (the test failed as expected).
- Planted failure: break `CharacterSheetGamblerRules.getModifierDice()`
  - Result: FAIL (the focused test still passed, showing that this new rules helper is not the source exercised by the calculation regression gate).
- Command: `npx playwright test test/e2e/specs/tgtt-gambler-rogue-clairnian.spec.ts --reporter=list`
  - Result: FAIL
  - Details: 5 passed, 2 skipped, 1 failed; the USE test timed out in `beforeEach`.
- Command: `RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-gambler-rogue-clairnian.spec.ts --reporter=list`
  - Result: FAIL
  - Details: 3 passed, 5 failed with `ERR_CONNECTION_REFUSED` after the web server stopped serving.
- Diagnostic command: same MEGA suite with `--workers=1`
  - Result: FAIL
  - Details: 6 passed, 2 failed with `ERR_CONNECTION_REFUSED`; the MEGA feature matrix itself completed.
- Command: `node scripts/auditE2eCoverage.mjs --strict`
  - Result: FAIL overall
  - Details: the Gambler spec reports FULL/111%, but other repository specs remain below the strict threshold. The metric also does not detect the missing new receipt/UI behaviors.
- Command: `npm run lint`
  - Result: FAIL
  - Details: 7 remaining ESLint errors in unrelated bestiary quick-action files. The command auto-fixed three unrelated files; those working-tree changes were restored before this review commit.
- Command: `npm test`
  - Result: FAIL
  - Details: stopped in `test:js` with 14 ESLint errors (the same pre-existing bestiary issues plus one padded-block error).

## Issues Found

1. **The 100-row effect layer is not complete.** Assigning almost every result the same manual fallback does not satisfy the requirement to automate safe canonical self/spell effects. Confirmation descriptors are also acknowledgements only, not executable transactions.
2. **Pending cast receipts are orphaned from the UI.** The state exposes choice/apply/acknowledge methods, but production code never calls them. Existing Gambling Table UI edits only the global last-roll record.
3. **Master of Fortune breaks cast atomicity.** The first roll determines slot preservation before the player chooses, while the spell cast proceeds before choice/confirmation resolution.
4. **Extra Luck's bonus-action bookkeeping is a parallel, incomplete action-economy system.** It is not synchronized with Play Mode and does not reset each turn.
5. **TGTT source gating and respec cleanup are incomplete.** Name-only matching enables non-TGTT leakage, and injected weapons survive removal of the subclass.
6. **Regression coverage is materially below the goal.** Direct state-shape assertions pass, but actual casting, slot mutation, UI resolution, cancellation, restored pending states, and most table effects are untested. The required Playwright gates are red.
7. **Required repository gates are red.** Both `npm run lint` and `npm test` fail.

## What Must Be Fixed

1. Make the Gambling Table descriptor registry canonical row by row. Implement every safe self/spell effect through existing condition, active-state, modifier, resource, inventory, and spell-transaction systems; reserve durable manual resolution for genuinely target/world/DM outcomes.
2. Add a real pending-resolution UI that can render, restore, choose, confirm, apply, acknowledge, save, and resume each cast receipt. Wire it to the receipt-specific APIs rather than only `gamblerLastTableRoll`.
3. Block/sequence the spell transaction so Master of Fortune choice and cast-changing results are resolved before slot consumption and before the spell outcome is finalized. Add actual cast integration tests for result 49, confirmation rows, cancellation, and one-modifier-per-cast behavior.
4. Integrate Extra Luck with the existing turn/action-economy model, reset it on a new turn, and prevent all public/direct use paths from bypassing the bonus-action cost. Test accept, decline, cancel, exhaustion, and all attack/save/ability/skill paths.
5. Require TGTT source identity for all Gambler-specific behavior and remove subclass-owned weapons/resources/pending state during respec or source disable.
6. Extend the Gambler Playwright spec/page objects with deterministic real-effect probes for all measurable mechanics and all required UI states. Make both required commands pass reliably, including `RUN_MEGA=1`.
7. Add focused Jest tests for per-row descriptor semantics and actual effect application, not only descriptor existence. Remove duplicated rule calculations or ensure every authoritative helper is covered by planted-failure tests.
8. Update Character Sheet, TGTT, E2E/testing/audit, and known-bug/reference documentation to match the implemented behavior accurately.
9. Restore the repository quality gates to green.
