# Inspector Feedback — Iteration 6

## Verdict: FAIL

The focused and repository gates are green, and the latest changes correct
several iteration-5 defects. The goal is still not complete: the Gambling
Table registry is not canonical, cleanup can delete unrelated resources, the
required browser coverage remains incomplete, and the mandatory full TGTT
shared-helper run has no completed passing result.

## Acceptance Criteria Check

- [x] **Gambler's Tools runtime:** the source-qualified feature grants card/dice
  tool proficiencies, injects the three equipped attacks with the published
  dice/ranges, and limits the coin ricochet rider to coins.
- [x] **Gambler spellcasting:** the published slot/cantrip progression, rolled
  prepared count, and one receipt-owned cast modifier are implemented.
- [x] **Gambler's Folly:** wager boundaries are exact and result 49 preserves
  the slot before the spell-effect pipeline.
- [x] **Extra Luck runtime:** attack/check/save consumers use the generic
  intervention path, with a PB-scaled long-rest pool and atomic bonus-action
  spend.
- [x] **Versatile Gambler:** level 13 upgrades the prepared dice to `3d6` and
  the Gambling Modifier to `2d4`.
- [x] **Master of Fortune runtime:** natural 1 becomes natural 20, downstream
  critical state is recomputed, the table rolls twice, and the persisted
  receipt requires a choice without spending a bonus action.
- [ ] **All 100 table descriptors:** every numeric key exists, but several
  scopes and canonical texts are wrong, and at least one safely modelable
  timed self-state remains a generic manual result.
- [x] **RNG seam:** Gambler rolls use the runtime-only per-sheet source and
  fall back to `Math.random`; the source is not serialized.
- [ ] **Lifecycle/source cleanup:** ordinary Gambler state is cleaned, but the
  name-only legacy-resource migration can delete an unrelated feature's
  `Extra Luck`/`Master of Fortune` resource.
- [x] **Accessibility/mobile implementation:** the inspected receipt UI uses
  native radios, labels/live status, explicit focus, immediate rerender, and
  44px action targets.
- [ ] **Targeted regression quality:** the new scope test is non-vacuous, but
  its hard-coded expected set omits still-wrong rows; the 100-row test verifies
  only IDs and the automation enum.
- [ ] **Playwright completeness:** the Gambler spec passes normally and in
  MEGA mode, but does not cover the browser surface mandated by the goal and
  by the updated E2E standard.
- [ ] **Documentation:** the support and known-bug documents claim canonical
  scope and unrelated-resource preservation despite counterexamples.

## Blocking Issues

### 1. The Gambling Table registry is not canonical

`js/charactersheet/charactersheet-gambler.js` still classifies:

- row 19, Wall of Fire encircling the Gambler, as `world` instead of `area`;
- row 29, Reverse Gravity affecting only the Gambler, as `world` instead of
  `self`;
- rows 68, 69, 71, 75, 80, and 87, all effects centered on or encircling the
  target, as `target` instead of `area`.

The test at
`CharacterSheetTGTTGamblerEffects.test.js:756-760` asserts a hand-picked list
that omits all of these rows, so it passes while the descriptor audit is still
wrong.

The descriptors are also built from a second, manually paraphrased 100-row
array in `charactersheet-state.js`, not the canonical TGTT table. Comparing the
runtime strings with `homebrew/TravelersGuidetoThelemar.json` after stripping
renderer tags found 17 differences. Several lose rules-relevant text:

- row 12 drops the statement that only the head is affected and other effects
  are for the DM to decide;
- row 18 drops that the Gambler is included in the radius;
- rows 20 and 64 drop the current-combat initiative-order consequence;
- row 41 drops the uncommon-to-very-rare magic-item bounds;
- row 98 drops the possible rebounding behavior.

Those omissions are persisted and shown as the durable manual-resolution text,
so the fallback is not faithful to the published result. Row 11 is also an
unambiguous timed self-state (no speech/casting and disadvantage on attacks for
`1d6` minutes), explicitly listed by the approved plan's automatic boundary,
but remains an undifferentiated manual descriptor.

### 2. Gambler cleanup can delete unrelated resources

`CharacterSheetState._getGamblerFeatureIds()` selects feature IDs only by the
names `Extra Luck` and `Master of Fortune`; it does not require the TGTT Rogue /
TGTT Gambler identity. `_cleanupGamblerArtifacts()` then removes same-named
resources owned by those IDs on every non-Gambler character.

An inspector-only regression created a non-Gambler `Extra Luck|HB` feature and
resource, called `_ensureGamblerResources()`, and expected the unrelated row to
remain. The actual resource array was empty. This directly contradicts
`gambler-rogue-support.md` and CS-BUG-171's claim that cleanup preserves
unrelated user-owned resources.

### 3. The Gambler E2E matrix still does not prove the required surface

The updated standard requires rendered cast-modifier output, restored pending
choice, automatic-effect expiry, and source-removal cleanup. The spec/page
object does not exercise those flows.

Additional omissions:

- `extraLuck` drives attack, ability-check, and skill-check controls, but not a
  saving throw, despite the source feature and acceptance criterion listing
  all four consumers.
- It checks spending and pending receipts, not that the second d20 changed the
  rendered result.
- No browser probe covers result 33, same-cast attack/save modifier reuse,
  decline/cancel no-spend, automatic effect application/expiry, respec cleanup,
  or wrong-source gating.
- The tools probe calls `getAttackRiderNotes` with a synthetic attack object
  and never verifies the rendered attacks' exact damage/properties or the two
  granted tool proficiencies.
- `ensureGamblerCastableLevel1Spell()` directly inserts a spell into state, and
  the delayed-cast probe monkeypatches `getFeatureCalculations()` to suppress
  Master of Fortune. These make the probe less representative of the actual
  level-20 build.

The full shared-helper command selected 383 tests and was started with a fresh
port, but remained a multi-hour run and was stopped before completion. Thus
the immutable full-TGTT passing criterion is still not established.

### 4. Documentation overstates the result

`docs/charactersheet/gambler-rogue-support.md` says all radius/group outcomes
are area-scoped and cleanup preserves unrelated state. CS-BUG-171 is marked
fixed with the same claims. Both are contradicted by the direct probes above.

### 5. Unrelated changes need tighter isolation

The cumulative branch also contains Bestiary quick-action formatting, monster
group/test changes, page-number test changes, and a broad crafting sanitizer.
`npm run gen:crafting` reproduced `data/crafting.json` exactly and entity counts
remained stable, so no generated-file drift was found. However,
`sanitizeCraftingTags()` converts every matching tag from six source families
to italics (475 source-tag occurrences in the initial generated file), rather
than checking individual resolvability. This broad non-Gambler policy change
should be independently justified or narrowed before landing.

## Validation Evidence

- `npm run test:unit -- test/jest/charactersheet/CharacterSheetTGTTGambler.test.js test/jest/charactersheet/CharacterSheetTGTTGamblerEffects.test.js --no-coverage --forceExit`
  — **PASS**: 2 suites, 120 tests.
- `PW_PORT=8516 npx playwright test test/e2e/specs/tgtt-gambler-rogue-clairnian.spec.ts --reporter=list`
  — **PASS**.
- `PW_PORT=8517 RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-gambler-rogue-clairnian.spec.ts --reporter=list`
  — **PASS**: all 8 tests.
- `PW_PORT=8518 RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-*.spec.ts --reporter=list --workers=2`
  — **INCOMPLETE**: 383 tests selected; stopped after the first few specs when
  the run again projected to take multiple hours. No suite failure was observed
  before stopping, but there is no passing result.
- `npm run lint` — **PASS**. The formatter rewrote unrelated tracked
  data/SCSS files; those worktree-only rewrites were reverted.
- `npm test` — **PASS**.
- `npm run gen:crafting` — **PASS** and reproduced the checked-in generated
  file with no diff (1,875 materials, 456 recipes, 46 rules, 72 item
  materials, 18 draconic resonances).
- `git diff --check 4a84b403c9f0c5e2e091673859e8f5d2585c492c..HEAD`
  — **PASS**.

## Non-Vacuity / Negative Probes

- Planting row 6 back outside `areaRows` made
  `keeps every canonical radius/group row explicitly area-scoped` fail.
- Reintroducing Master of Fortune's bonus-action spend made
  `does not spend the shared bonus action for Master of Fortune` fail.
- An inspector-only two-case regression failed on both currently uncovered
  defects: row 19 returned `world` instead of `area`, and cleanup deleted an
  unrelated same-named resource.
- All temporary probes and formatter output were removed; the worktree was
  clean before writing this report.

## Required Iteration-7 Work

1. Derive or verify the runtime table text against the canonical TGTT rows;
   restore every omitted rule detail and correct all scopes, including rows
   19, 29, 68, 69, 71, 75, 80, and 87.
2. Complete the approved safe self-state automation boundary, especially row
   11, or document and test a concrete architectural reason it cannot use the
   existing state systems.
3. Source-qualify legacy fortune-feature ownership before migrating/removing
   resources, and add the unrelated same-name regression.
4. Extend the Gambler Playwright probe to cover the save consumer and every
   lifecycle explicitly required by `docs/e2e/comprehensive-test-standard.md`,
   using rendered character state rather than synthetic attacks, direct spell
   insertion, or feature-calculation monkeypatching.
5. Complete the full TGTT MEGA command and retain its final pass/fail summary.
6. Correct the support and known-bug documentation, and isolate or justify the
   unrelated Bestiary/crafting/test policy changes.
