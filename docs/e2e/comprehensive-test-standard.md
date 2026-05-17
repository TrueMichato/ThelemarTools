# Comprehensive E2E Character Test Standard

This document is a reader-facing pointer.  The authoritative content
lives in the
[`e2e-character-tests`](../../.agents/skills/e2e-character-tests/) skill
so that AI agents pick it up automatically when writing or extending
Playwright character-build specs.

## No blind spots (contract)

Every `tgtt-*.spec.ts` must include **explicit** checks for every:

- **feature picked** (class, subclass, race, feat, optional-feature),
- **milestone hit** (Extra Attack, slot table change, prof bump, capstone),
- **loadout change** (gear that should move AC / attack / DC),
- **signature toggle** (Rage, Bladesong, Channel Divinity, Wild Shape, …),
- **specialty pick** (TGTT class-feature `Specialties` pool),
- **mastery pick** (XPHB Weapon Mastery for martials), and
- **battle-tactic pick** (Fighter Battle Tactics, plus the parallel
  Metamagic / Invocation / Jester Act / Trickster Trick / Precise
  Strike / Pact Boon / Dreamwalker pickers).

**Use the `build*Checks` helpers** in
[`test/e2e/utils/tgttFeaturePools.ts`](../../test/e2e/utils/tgttFeaturePools.ts)
— they are the canonical DRY surface for picker-shaped coverage.
They emit the right `featuresMatrix` rows AND attach
`pickedFeatureGrants` effect probes for the auto-picker's first
choice, so existence + effect verification land together. Don't
open-code pools or per-pick effect probes when a helper exists.

"Coverage gap stays visible" still applies: when a check genuinely
doesn't apply, `{skip: true}` with a one-line reason — don't drop the
field.

## Post-test JSON export (automatic)

Every generated test (single-class L1/L3/L5/L5-loadout/MEGA/USE/round-trip
plus the multiclass plan test) dumps `cs._state.toJson()` to:

```
test-results/exports-for-validation/<display-slug>/<test-title-slug>--<status>.json
```

on both pass and fail. The drop is wired in
[`characterSpecFactory.ts`](../../test/e2e/utils/characterSpecFactory.ts)
(`_exportCharacterForValidation`) as a Playwright `afterEach` and is
transparent to spec authors — no spec change required, no extra cost
beyond a few KB of disk per test.

Use the exports to manually load a build into the live character sheet
and sanity-check anything the suite couldn't probe directly (rendering
quirks, layout, art, fluff). `test-results/` is already gitignored.

## Why a standard?

The `test/e2e/specs/tgtt-*.spec.ts` suite drives the full character
sheet — creation wizard, level-up wizard, loadout, in-play usage —
through real DOM.  It exists to catch ~95% of the bugs a player would
run into when picking one of the canonical TGTT character archetypes.
Without a shared standard, specs drift in coverage and we miss obvious
gaps (e.g. nobody rolls a skill, nobody short-rests a Warlock).

## The required-checks list

See **[skill standard](../../.agents/skills/e2e-character-tests/references/standard.md)**
for the canonical numbered list (currently **22 checks**).  At a glance:

1. L1 creation via builder wizard
2. L3 subclass arrival
3. L5 milestone (Extra Attack / 3rd-level slots / prof +3)
4. L5 loadout: gear changes derived stats
5. L5 signature toggle changes derived stats
6. MEGA L1→20 with milestone asserts
7. USE: cast a spell decrements a slot
8. USE: spend a class resource
9. USE: weapon attack roll button
10. USE: long rest restores spell slots
11. USE: skill roll bonus + button
12. USE: short rest restores SR-class resource
13. USE: concentration breaks on damage / Rage
14. USE: death save tracker
15. USE: condition apply / check / remove
16. USE: feat-toggle delta (when applicable)
17. L1 export round-trip preserves identity
18. Multiclass: usage probes after each leg
19. TGTT Specialties: cumulative pick coverage **+ per-pick effect** (use `buildSpecialtyChecks`)
20. Weapon Mastery: pickedFrom + rollAttack **+ per-mastery effect** (martial classes)
21. Battle Tactics / class-option pickers: pickActivatable **+ per-pick effect** (Metamagic, Invocations, Acts, Tricks, Strikes, Pact Boons, Dreamwalker)
22. **Per-feature effect coverage** *(new, applies to every entry)* — every non-cinematic `featuresMatrix` row must attach at least one `EffectCheck` (or carry a `// no measurable derived effect: <reason>` comment).  Existence-only assertions are insufficient.

> **Effect verification is a first-class requirement.**  When a feature
> grants advantage on a save, prove the advantage flag flips.  When a
> toggle adds INT to AC, snapshot AC, toggle, assert the delta.  When a
> metamagic option boosts spell damage, assert the rendered damage
> changes.  See the
> [Effect verification doctrine](../../.agents/skills/e2e-character-tests/references/standard.md#effect-verification-every-feature-should-do-something)
> for the decision tree and canonical examples.

Every spec lists every check, even when skipping (use `{skip: true}` with
a one-line reason — coverage gaps stay visible).

## Suite catalog

See [`test-suite-catalog.md`](./test-suite-catalog.md) for the full
list of TGTT character specs — build, level scope, and the one-line
"what it proves" hook for each.

## Authoring a new character spec

1. Open the `e2e-character-tests` skill.
2. Copy the template from
   [`spec-template.md`](../../.agents/skills/e2e-character-tests/references/spec-template.md).
3. Walk the 10-step authoring checklist.
4. Run the spec locally (with and without `RUN_MEGA=1`) before pushing.

## Running the suite

```bash
# Full suite with MEGA L1→20 paths (~45 min on --workers=2):
RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-*.spec.ts \
  --reporter=list --workers=2

# Single spec:
npx playwright test test/e2e/specs/tgtt-mercy-monk-changeling.spec.ts

# Open last HTML report:
npx playwright show-report
```

## Pointers

- Skill root: [`.agents/skills/e2e-character-tests/`](../../.agents/skills/e2e-character-tests/)
- Standard: [`references/standard.md`](../../.agents/skills/e2e-character-tests/references/standard.md)
- Spec template + checklist: [`references/spec-template.md`](../../.agents/skills/e2e-character-tests/references/spec-template.md)
- Page-object API: [`references/page-objects.md`](../../.agents/skills/e2e-character-tests/references/page-objects.md)
- Factory test map: [`references/factory-tests.md`](../../.agents/skills/e2e-character-tests/references/factory-tests.md)
- Troubleshooting infra vs product: [`references/troubleshooting.md`](../../.agents/skills/e2e-character-tests/references/troubleshooting.md)
- Known product bugs surfaced by the suite: [`docs/charactersheet/known-bugs.md`](../charactersheet/known-bugs.md)

## Pre-PR coverage check

Run the audit before opening a PR:

```sh
node scripts/auditE2eCoverage.mjs
```

The script reports per-spec EffectCheck coverage (effects + helpers +
reason-comments) and flags specs below 80%. Either backfill effects
or add `// no measurable derived effect: <reason>` comments.
