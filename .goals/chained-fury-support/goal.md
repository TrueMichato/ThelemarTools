# Goal: Complete Chained Fury support

## User Request

Implement complete Character Sheet support for the TGTT Chained Fury Barbarian subclass. Every chain and grapple mechanic must work mechanically rather than merely appear as text, including target selection, reach/range, attack and save resolution, grapple state, escape DCs, movement and dragging, damage riders, resource costs, Rage gating, action economy, release/end conditions, display, persistence, and comprehensive tests.

## Refined Goal

Extend the existing Chained Fury calculations, Spectral Chains attack, and Rage-gated active state with a reusable persisted target-effect lifecycle. Players must be able to resolve chain attacks against lightweight named targets, track grappled/restrained state and chain occupancy, resolve movement, escape, recurring damage, and teardown correctly, and recover valid state after save/load. The implementation must remain architecture-first, accessible, responsive, source-gated, backward compatible, and mechanically verified through targeted Jest and the existing comprehensive Playwright build.

## Acceptance Criteria

- [ ] All canonical level 3, 6, 10, and 14 Chained Fury values and mechanics match `homebrew/TravelersGuidetoThelemar.json`, including damage die, range, magical damage, chain count, grapple size, restraint DC/damage, shove distance, movement rules, and all-chain Extra Attack.
- [ ] Spectral Chains is a real feature-granted attack and cannot appear or retain targets unless both Rage and Manifest Chains are active.
- [ ] A Spectral Chains hit can select or create a lightweight target and resolve no rider, Grapple, or Shove through a target-aware combat flow.
- [ ] Initial chain grapple and escape use the TGTT Grapple method contract: target chooses Strength or Dexterity save against the current method DC. Chain Imprisonment uses a separate Strength save against `8 + proficiency bonus + Constitution modifier`; these DCs are never conflated.
- [ ] Legal target size, current chain range, and concurrent chain capacity are validated. Re-grappling the same target updates rather than duplicates its effect.
- [ ] Grappled and restrained targets persist across save/load with stable IDs, while derived values such as range, DC, damage, and size handling are recalculated from the current character.
- [ ] Restrained targets expose explicit start-of-target-turn force damage equal to current Barbarian level, with duplicate-resolution protection and an explicit repeat override.
- [ ] Chained target movement tracks player-declared distance, validates final range, applies size-adjusted drag cost before level 14, removes only the extra drag surcharge at level 14, and consumes the bonus action exactly once when doubling chain-only movement.
- [ ] Level 10's immediate 10-foot shove after a successful grapple rejects a declared final distance outside current chain range.
- [ ] Escape success, manual release, out-of-range movement, Rage or Manifest Chains ending, incapacity/death teardown, rest/reset, level-down, respec, subclass/source removal, and stale-load reconciliation atomically remove grapple, restraint, recurring damage, and chain occupancy.
- [ ] Level 14 allows three attacks only when every attack in that Attack action is Spectral Chains; mixed Attack actions retain the normal allowance.
- [ ] The target-aware path is generic and opt-in, preserving existing prompt-only `attackOnHitOptions`, active states, conditions, action economy, and old saves for unrelated features.
- [ ] The Combat tab and Play Mode show a clear Chained Targets surface with target name, size, declared distance, Grappled/Restrained state, recurring damage, range/capacity warnings, and Move/Resolve Turn/Escape/Release actions.
- [ ] All custom flows use `CharacterSheetModal.pGetShow`, preserve focus, keyboard operation, ARIA labeling/announcements, 44px mobile controls, safe-area footer clearance, single-column mobile layouts, and day/night token parity.
- [ ] Builder, LevelUp, and QuickBuild all ingest the subclass consistently without introducing a new picker for a subclass that has no build-time choices.
- [ ] Targeted Jest tests verify calculations, state transitions, persistence/migrations, teardown, movement/action economy, and progression. The tests must be made to fail at the real implementation gate before trusting them.
- [ ] `test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts` drives the actual Spectral Chains attack and target lifecycle, spends/restores Rage, retains concentration-break coverage, and gives every measurable feature a concrete effect assertion.
- [ ] Focused Jest, focused Playwright, and `RUN_MEGA=1` matrix coverage pass with no unexplained skips. Any unrelated real product bug is documented as `CS-BUG-NNN`, not hidden with weaker assertions.
- [ ] Relevant Character Sheet subsystem, toggle, limitations, and E2E catalog documentation is updated.

## Scope Boundaries

**In scope:**
- Existing Chained Fury calculation and active-state integration.
- A generic, persisted lightweight combat target/effect model suitable for target-attached conditions and recurring effects.
- Spectral Chains target selection, saves, range/size/capacity, movement, action economy, recurring damage, escape/release, teardown, save/load, display, accessibility, responsive styling, and tests.
- Directly related Builder/LevelUp/QuickBuild regression fixes if one progression path fails.
- Directly related documentation and reference updates.

**Out of scope:**
- Building a VTT, tactical map, initiative tracker for enemies, collision/terrain/hazard resolution, or automatic enemy statistics.
- Inventing enemy modifiers, AC, saving throws, or positions. Enemy outcomes and tactical distance remain player-confirmed facts.
- Editing canonical TGTT rules text unless an implementation-blocking data defect is proven.
- Broad refactors unrelated to target effects or Chained Fury.
- Fixing unrelated pre-existing test or product failures.

## Applicable Project Conventions

**Quality gate commands:**
- `npm run test:unit -- CharacterSheetChainedFury CharacterSheetTargetEffects CharacterSheetCombat CharacterSheetToggleAbilities --no-coverage --forceExit`
- `npx playwright test test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts --reporter=list`
- `RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts --reporter=list`
- `npm run test:js`
- `npm run test:css`
- Escalate to `npm test` when shared-state or shared-combat changes pass focused gates.

**Commit convention:**
- Conventional commits with Goal role marker: `type(scope): [B] description` for Builder and `chore(scope): [I] description` for Inspector, title at most 72 characters.
- Include the repository-required co-author trailer: `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`.
- Include Goal trailer: Builder `Assisted-by: OpenAI:GPT-5.6 Luna`; Inspector `Assisted-by: OpenAI:GPT-5.6 Sol`.

**Guidelines:**
- `AGENTS.md`
- `.github/instructions/charactersheet.instructions.md`
- `.github/instructions/e2e.instructions.md`
- `.agents/skills/charactersheet-development/references/architecture.md`
- `.agents/skills/charactersheet-development/references/feature-calculations.md`
- `.agents/skills/charactersheet-development/references/subsystem-details.md`
- `.agents/skills/charactersheet-development/references/testing-guide.md`
- `.agents/skills/charactersheet-development/references/development-status.md`
- `.agents/skills/5etools-data/references/classes-subclasses.md`
- `.agents/skills/troubleshooting/references/common-errors.md`
- `.agents/skills/e2e-character-tests/references/standard.md`
- `.agents/skills/e2e-character-tests/references/spec-template.md`
- `.agents/skills/e2e-character-tests/references/page-objects.md`

**Rules:**
- `CharacterSheetState` remains the source of truth; UI changes must explicitly re-render and save.
- Extend existing calculations, active states, `grantedAttacks`, `attackOnHitOptions`, `attackActionAllowances`, action economy, modal shell, and page-object/factory patterns before adding abstractions.
- Do not create parallel state, rendering, effect, attack, or test systems.
- Preserve backward compatibility through defaults, migrations, and reconciliation.
- Use shared helpers and data-driven metadata instead of subclass-name branches when the behavior can support future target-attached features.
- E2E specs remain thin and use page objects; every measurable feature needs a real effect probe.
- UI must follow the existing Character Sheet design system and the Impeccable shape brief embedded in the accepted implementation plan.

