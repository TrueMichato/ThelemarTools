# Goal: Complete TGTT Gambler Rogue support

## User Request

Implement the approved code-ready plan for complete Character Sheet support for the TGTT Gambler Rogue subclass. Continue autonomously until the implementation is complete and independently verified.

The source plan is available at:
`/Users/tommichaeli/.copilot/session-state/7911e51a-36b9-466a-86c4-b20d917066d9/plan.md`

## Refined Goal

Deliver complete, production-ready Character Sheet support for every published TGTT Gambler Rogue feature from levels 3 through 17. Preserve the existing Character Sheet architecture, make random mechanics deterministic in tests without weakening production randomness, resolve every Gambling Table result either through safe canonical state mutation or an explicit durable manual-resolution flow, and prove all measurable mechanics through targeted Jest and comprehensive Playwright coverage.

## Acceptance Criteria

- [ ] Gambler's Tools grants card-set and dice-set proficiency, creates correct coin/dice/card attacks, and applies the coin half-cover rider without leaking to other characters.
- [ ] Gambler spellcasting uses the exact published cantrip and slot progression, rolls the correct daily prepared-spell allowance, and rolls one cast-scoped Gambling Modifier reused across every attack/save produced by that cast.
- [ ] Gambler's Folly uses exact wager odds for spell levels 1-4, triggers the Gambling Table on a loss, and handles slot/cast overrides such as result 49 atomically.
- [ ] Extra Luck works on attack rolls, saving throws, ability checks, and skill checks; atomically spends its PB-scaled long-rest resource and required bonus action; and spends nothing when declined or cancelled.
- [ ] Versatile Gambler changes prepared-spell dice to 3d6 and Gambling Modifier dice to 2d4 at Rogue level 13.
- [ ] Master of Fortune changes a natural 1 to a natural 20, updates downstream critical/fumble interpretation, rolls twice on the Gambling Table, requires a player choice, spends its PB-scaled long-rest resource, and preserves unresolved/resolved choices across save/load.
- [ ] Every one of the 100 canonical Gambling Table rows has an explicit implementation descriptor. Safe self/spell effects use existing active-state, condition, modifier, resource, and spell transaction systems; target/world/DM-adjudicated effects remain explicit durable manual resolutions with no silent no-op.
- [ ] All Gambler randomness uses a per-sheet injectable RNG seam in tests and genuine production randomness otherwise; tests do not globally monkeypatch Math.random.
- [ ] Builder, LevelUp, QuickBuild, respec, rest, save/load, and TGTT source gating produce consistent level-correct behavior with backward-compatible defaults and cleanup.
- [ ] Wager, prepared-spell, fortune-intervention, result-choice, resource, confirmation, error, pending, and restored states follow the existing Character Sheet design system and are keyboard-accessible, screen-reader-legible, responsive, and usable on mobile.
- [ ] Targeted Jest tests assert real state/effect changes and are demonstrated to fail against planted violations before final validation.
- [ ] The Gambler Playwright spec covers every measurable subclass feature with deterministic real-effect probes and passes normally and with `RUN_MEGA=1`; shared E2E helper changes pass the full TGTT suite.
- [ ] Related Character Sheet, TGTT, testing, E2E, audit, and known-bug documentation is updated.

## Scope Boundaries

**In scope:**
- `homebrew/TravelersGuidetoThelemar.json` as the canonical rules source; edit it only if a demonstrable data defect must be corrected.
- Character Sheet state, class utilities, spell casting, combat, feature/resource, rest, Builder, LevelUp, QuickBuild, respec, save/load, and relevant UI/CSS integration.
- A bounded reusable Gambler rules/effect layer if needed to keep the 100-row table out of the monolithic state/UI code.
- Existing generic post-roll, active-state, condition, modifier, attack, resource, modal, and spell systems.
- Targeted Jest tests, comprehensive Gambler Playwright tests, shared page-object/effect helpers, and directly related documentation.

**Out of scope:**
- A general target/world encounter model.
- Automatically making DM decisions for random creatures, planes, magic items, body swaps, transformations, or narrative outcomes.
- Casino-themed visual redesign, slot-machine animation, new semantic colors, or a parallel Character Sheet/roller/casting architecture.
- Unrelated Character Sheet bugs or broad refactors beyond what the Gambler implementation requires.

## Applicable Project Conventions

**Quality gate commands:**
- `npm run test:unit -- <targeted test paths> --no-coverage --forceExit`
- `npx playwright test test/e2e/specs/tgtt-gambler-rogue-clairnian.spec.ts --reporter=list`
- `RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-gambler-rogue-clairnian.spec.ts --reporter=list`
- If shared E2E helpers/page objects change: `RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-*.spec.ts --reporter=list --workers=2`
- Final repository gates for touched surfaces: `npm run lint`, `npm test`

**Commit convention:**
- Conventional commits.
- Builder title: `type(scope): [B] description` (72 characters maximum).
- Inspector title: `chore(scope): [I] description` (72 characters maximum).
- Builder trailer: `Assisted-by: OpenAI:GPT-5.6 Luna`
- Inspector trailer: `Assisted-by: OpenAI:GPT-5.6 Sol`
- All commits also include: `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`

**Guidelines:**
- `AGENTS.md`
- `.github/instructions/charactersheet.instructions.md`
- `.github/instructions/e2e.instructions.md`
- `.agents/skills/5etools-data/references/classes-subclasses.md`
- `.agents/skills/charactersheet-development/references/architecture.md`
- `.agents/skills/charactersheet-development/references/feature-calculations.md`
- `.agents/skills/charactersheet-development/references/subsystem-details.md`
- `.agents/skills/charactersheet-development/references/testing-guide.md`
- `.agents/skills/charactersheet-development/references/development-status.md`
- `.agents/skills/troubleshooting/references/common-errors.md`
- `.agents/skills/e2e-character-tests/references/standard.md`
- `.agents/skills/e2e-character-tests/references/spec-template.md`

**Rules:**
- `CharacterSheetState` remains the single source of truth; UI changes must explicitly re-render and save.
- Prefer generic reusable helpers and existing registries/pipelines over scattered Gambler name checks.
- Preserve backward-compatible saves and TGTT source gating.
- Do not parse Gambling Table entries into permanent feature modifiers or generic activatable features.
- Use published subclass tables rather than substituting generic third-caster progression.
- Every measurable feature needs a deterministic real-effect regression assertion; existence-only tests are insufficient.
- Specs remain thin and all DOM interaction stays in page objects/shared helpers.
- Use tabs and existing Character Sheet style/token conventions.
