# E2E Character Test Standard

The authoritative list of checks every comprehensive E2E character build
test must cover.  This is what the `characterSpecFactory` generates and
what every TGTT character archetype is expected to pass — modulo
explicit `{skip: true}` opt-outs anchored to a CS-BUG-NNN entry.

## Goal

Catch ~95% of the problems a player would hit between picking a class
combo and playing through 20 levels of it.  The suite must validate
the **mechanics**, not just the wiring — that means actually using the
character: cast spells, spend resources, attack, roll skills, rest.

## No blind spots

Every spec must include **explicit** checks for every:

- **feature picked** — class, subclass, race, feat, optional-feature,
- **milestone hit** — Extra Attack, slot-table change, prof bump, capstone,
- **loadout change** — gear expected to move AC / attack / DC at L5,
- **signature toggle** — Rage / Bladesong / Channel Divinity / Wild Shape / …,
- **specialty pick** — TGTT class-feature `Specialties` pool,
- **mastery pick** — XPHB Weapon Mastery (martials), and
- **battle-tactic pick** — Fighter Battle Tactics + the parallel
  Metamagic / Invocation / Jester Act / Trickster Trick / Precise
  Strike / Pact Boon / Dreamwalker pickers.

Checks #19 (Specialties), #20 (Weapon Mastery), #21 (class-option
pickers), and #22 (per-feature effect coverage) below operationalize
this rule per-feature; the rule itself is the **contract**.

### Use `build*Checks` — don't open-code pools

The DRY surface is
[`test/e2e/utils/tgttFeaturePools.ts`](../../../../test/e2e/utils/tgttFeaturePools.ts).
Every picker has a matching `build*Checks(...)` helper that:

1. Emits the right `featuresMatrix` rows at the right levels with the
   correct cumulative `pickedCount`.
2. Attaches a `pickedFeatureGrants` effect for the auto-picker's
   deterministic first choice, so existence + effect verification land
   in one helper call.

Spec authors **spread** helper output into the matrix; they don't
open-code pools, levels, cumulative counts, or per-pick effects when
a helper exists. See the table under [Helpers for class-option
pickers](#helpers-for-class-option-pickers) for the full inventory.

## Required checks (the standard)

| # | Check | Where it lives | Why it matters |
|---|---|---|---|
| 1 | **L1 creation via builder wizard** | factory `L1: creates …` | Smoke-tests the entire creation pipeline (race, class, subclass, ability allocation, signature spells/items). |
| 2 | **L3 subclass arrival + initial subclass feature** | factory `L3: subclass arrives …` | Subclass selection actually grants its L3 feature on the Features tab. |
| 3 | **L5 milestone (Extra Attack / 3rd-level slots / prof +3)** | factory `L5: extra attack …` | Mid-tier mechanics turn on. Caster slot tables advance; martials get Extra Attack. |
| 4 | **L5 loadout: gear changes derived stats** | factory `L5 loadout …` | Inventory/attunement actually affects AC, attack bonus, or DC. |
| 5 | **L5 signature toggle changes derived stats** | same test, `probeToggleDelta` | Class-defining toggle (Bladesong, Rage, Channel Divinity, …) measurably changes AC or DC. |
| 6 | **MEGA L1→20 with milestone asserts at 3/5/11/17/20** | factory `MEGA L1→20 …` (RUN_MEGA gated) | The wizard can drive 19 sequential level-ups without crashing; HP/slots/resources scale per the rules. |
| 7 | **USE: cast a spell decrements a slot** | factory `USE: …`, `castSpellAtSlot` | The full cast pipeline (state.useSpellSlot → render → DOM pip count). |
| 8 | **USE: spend a class resource decrements its counter** | factory `USE: …`, `useResourceByName` | Ki/Sorcery/CD/BI/Rage tracker decrements via UI-equivalent state hook. |
| 9 | **USE: weapon attack roll button is wired** | factory `USE: …`, `clickAttackRoll` | Auto-equipped weapon shows up on Combat tab and the roll button doesn't throw. |
| 10 | **USE: long rest restores spell slots** | factory `USE: …`, `triggerLongRest` | Full caster slots come back. |
| 11 | **USE: skill roll bonus is finite + button is wired** *(new)* | factory `USE: skill roll`, `rollSkill` | Skill bonus collapses prof + ability + expertise + bonuses correctly; button on Abilities tab clickable. |
| 12 | **USE: short rest restores SR-class resource** *(new)* | factory `USE: short rest`, `shortRestRestores` | Pact slots / Discipline Points / Channel Divinity / Bardic Inspiration / Wild Shape come back as appropriate. |
| 13 | **USE: concentration breaks on damage / Rage** *(new)* | factory `USE: concentration`, `getConcentrationStatus` | Rage breaks concentration (Barbarian); damage breaks it for casters. State-level pipeline intact. |
| 14 | **USE: death save tracker advances** *(new)* | factory `USE: death saves`, `markDeathSave` | Successes and failures both increment, top out at 3, reset cleanly. |
| 15 | **USE: condition apply → check → remove** *(new)* | factory `USE: condition`, `applyCondition` | Conditions added via state show up via `hasCondition`; removable; expected derived effect (e.g. speed = 0). |
| 16 | **USE: feat-toggle delta** *(new, optional)* | factory `USE: feat`, `probeToggleDelta` | If the build takes a feat with an active toggle (Lucky, GWM, Sharpshooter), the toggle measurably changes a derived stat. |
| 17 | **L1 export round-trip preserves identity** | factory `L1 export round-trip …` | `state.toJson()` → `state.loadFromJson()` preserves name and L1 state. |
| 18 | **Multiclass: usage probes after each leg** *(new)* | factory multiclass test, `usageAfterEachLeg` | After each multiclass leg, the secondary class actually works — slot, resource, attack, skill all functional. |
| 19 | **TGTT Specialties: cumulative pick coverage + per-pick effect** *(new)* | per-spec `featuresMatrix` via `buildSpecialtyChecks(className)` | Every TGTT class grants cumulative "Specialties" picks at fixed levels (Fighter 1/5/9/13/17, Monk 2/4/…, Cleric 3/7/…, etc.). Each milestone must assert ≥N distinct specialty names land on the sheet, AND attach a `pickedFeatureGrants` effect for the auto-picker's deterministic first pick (verifies the picked specialty's documented mechanical effect — proficiency, passive bonus, advantage, etc. — actually surfaces). |
| 20 | **Weapon Mastery: pickedFrom + rollAttack + per-mastery effect** *(new, martials)* | per-spec `featuresMatrix` `pick` with `rollAttack` + `pickedFeatureGrants` | XPHB martials gain Weapon Mastery at L1. The picked weapons must surface as attacks, roll without throwing, and the mastery property must observably modify attack output (Vex → advantage flag, Topple → save line, Sap → disadvantage rider, etc.). |
| 21 | **Class-option pickers + per-pick effect** *(new, Fighter / Sorcerer / Warlock / Bard / Rogue)* | per-spec `featuresMatrix` `pick` with `pickActivatable` + `pickedFeatureGrants` | Fighter Battle Tactics (2 at L3, +1 at L7/10/15), Sorcerer Metamagic, Warlock Invocations, Jester Acts, Trickster Tricks, Precise Strikes, Pact Boons, Dreamwalker calls / studies — each must register the picked option as a feature on the sheet AND attach `pickedFeatureGrants` so the auto-picked option's documented effect (damage rider, attack bonus, resource cost, toggle) is verified. |
| 22 | **Per-feature effect coverage** *(new, applies to every entry)* | every `featuresMatrix` row | Every non-cinematic feature, ability, feat, spell, attack, or item in the matrix MUST attach at least one `EffectCheck` (or carry a `// no measurable derived effect: <reason>` comment). Existence-only assertions are insufficient — see [Effect verification](#effect-verification-every-feature-should-do-something) below. |

## Helpers for class-option pickers

For TGTT classes, use the shared pools in
[`test/e2e/utils/tgttFeaturePools.ts`](../../../../test/e2e/utils/tgttFeaturePools.ts).
The file is auto-generated by
[`scripts/genTgttPools.mjs`](../../../../scripts/genTgttPools.mjs)
from `homebrew/TravelersGuidetoThelemar.json`. Regenerate with:

```bash
node scripts/genTgttPools.mjs
```

The generator emits the following pools and their matching
`build*Checks` helpers:

| Pool | Helper | Picker family |
|---|---|---|
| `TGTT_SPECIALTIES` + `TGTT_SPECIALTY_LEVELS` | `buildSpecialtyChecks(className, levelMap?)` | TGTT class-base specialties (every class) |
| `TGTT_BATTLE_TACTICS` + `TGTT_BATTLE_TACTICS_CUM` | `buildBattleTacticChecks(levelMap?)` | Fighter Battle Tactics (BT) |
| `TGTT_METAMAGIC` | `buildMetamagicChecks(levelMap?, count?)` | Sorcerer Metamagic (MM) |
| `TGTT_ELDRITCH_INVOCATIONS` | `buildInvocationChecks(levelMap?, count?)` | Warlock TGTT-flavoured Eldritch Invocations (EI) |
| `TGTT_JESTER_ACTS` | `buildJesterActChecks(levelMap?)` | Jester Bard subclass Acts (JA) |
| `TGTT_TRICKSTER_TRICKS` | `buildTricksterTrickChecks(levelMap?)` | Trickster Rogue subclass Tricks (TT) |
| `TGTT_PRECISE_STRIKES` | `buildPreciseStrikeChecks(levelMap?)` | Precise Strikes (PS) |
| `TGTT_PACT_BOONS` | `buildPactBoonChecks(levelMap?)` | TGTT Pact Boons (PB) |
| `TGTT_DREAMWALKER_CUSTOMS` / `TGTT_DREAMWALKER_SPECIALS` | `buildDreamwalkerChecks(levelMap?)` | Dreamwalker calls / studies (DW:C / DW:S) |
| `TGTT_COMBAT_METHODS_BY_TRADITION` | n/a (read directly when needed) | Per-tradition combat-method pool |
| `XPHB_WEAPON_MASTERY_EFFECTS` (hand-written) | `buildWeaponMasteryChecks(weaponNames)` | XPHB Weapon Mastery picks |
| `EI_XPHB` / `EI_XGE` / `EI_PHB` / `EI_TCE` | `buildAnyInvocationChecks(sources?, progression?, levelMap?)` | Cross-source Eldritch Invocations (Warlock dips into XPHB + XGE + TGTT) |
| `MM_XPHB` / `MM_PHB` / `MM_TCE` | `buildAnyMetamagicChecks(sources?, progression?, levelMap?)` | Cross-source Metamagic (Sorcerer can mix XPHB MM with TGTT MM) |
| `AS_XGE` | `buildAnyArcaneShotChecks(progression?, levelMap?)` | XGE Arcane Shot options (Arcane Archer Fighter) |
| `MVB_XPHB` / `MVB_PHB` / `MVB_TCE` | `buildAnyManeuverChecks(sources?, progression?, levelMap?)` | Battle Master Maneuvers across sources |
| `PB_PHB` / `PB_TCE` | `buildAnyPactBoonChecks(sources?, progression?, levelMap?)` | Cross-source Pact Boons (TGTT + PHB Warlock) |
| `ZODIAC_FORMS_L3` / `ZODIAC_FORMS_L10` | `buildZodiacFormChecks(levelMap?)` | Zodiac Druid form catalogs (12 forms at L3, 12 more at L10) |
| `DEBILITATION_PRECISE_STRIKES_L3` | `buildCatalogChecks({pool, level, …})` | Subclass-feature catalog helper for any subclass that enumerates options as individual `subclassFeature` entries |

Spread the helper output into your spec's `featuresMatrix`:

```ts
import {buildSpecialtyChecks, buildMetamagicChecks} from "../utils/tgttFeaturePools";

const FOO_FEATURES_MATRIX: FeatureCheck[] = [
    // … class-specific entries …
    ...buildSpecialtyChecks("Sorcerer"),
    ...buildMetamagicChecks(),
];
```

For multiclass specs, pass a `levelMap` mapping class-level → spec
character-level so the matrix targets the right characterLevel.

Each helper also attaches a `pickedFeatureGrants` effect for the
auto-picker's deterministic first choice, so the test verifies not
just that a pick surfaced but that the chosen option's documented
mechanical effect lands on the sheet (see
[Effect verification](#effect-verification-every-feature-should-do-something)
below).

## Effect verification: every feature should *do* something

> **First-class requirement.** A test that asserts a feature exists on
> the sheet but never asserts the feature *does what it documents* is
> not pulling its weight. The whole point of this suite is to catch
> the bugs a player hits — and players hit the case where Bladesong
> "exists" but doesn't add INT to AC, where Aura of Protection
> "exists" but doesn't bump saves, where Hexblade's Curse "exists"
> but doesn't add proficiency to damage. Existence is the smoke test;
> the **effect probe is the real test**.

### When to attach an effect probe

Attach at least one `EffectCheck` to every `featuresMatrix` entry
unless the feature is genuinely non-mechanical (then leave a
`// no measurable derived effect: <reason>` comment so audit diffs
stay clean). Use this decision tree:

| Feature shape | Effect family | Concrete `kind` |
|---|---|---|
| Adds a flat bonus to a save | passive numeric | `saveBonus` |
| Adds a flat bonus to a skill / passive score | passive numeric | `skillBonus` |
| Sets / increases an ability score | passive numeric | `abilityScore`, `abilityMod` |
| Increases AC, speed, initiative | passive numeric | `ac`, `speed`, `initiative` |
| Sets / increases spell save DC | passive numeric | `spellSaveDc` |
| "You have advantage on X" | flag | `advantage`, `skillAdvantage` |
| "You have disadvantage on X" | flag | `disadvantage` |
| Damage resistance / immunity / vulnerability | flag | `resistance`, `immunity`, `vulnerability` |
| Adds a spell to a list / known | spell | `spellInList`, `cantripCount` |
| Toggle that adds/removes AC while active | toggle delta | `togglePlusAc` |
| Toggle that adds/removes speed while active | toggle delta | `togglePlusSpeed` |
| Toggle that grants resistance / advantage / immunity | toggle flag | `toggleGrantsResistance`, `toggleGrantsAdvantage`, `toggleGrantsImmunity` |
| Adds a roll button (Bardic Inspiration, Channel Divinity option, …) | roll | `rollAbilityCheck`, `rollSavingThrow`, `rollSkillCheck`, `rollAttack`, `rollInitiative` |
| Restores a resource on long / short rest | resource | `longRestRestores`, `shortRestRestores` |
| Adds an attack to the Combat tab | attack | `attackPresent` |
| Modifies attack-bonus / damage line | attack | `attackBonus`, `attackDamageContains` |
| Sneak Attack / martial-arts / inspiration die size | dice | `sneakAttackDice`, `martialArtsDie`, `bardicInspirationDie` |
| Pick-list option (Metamagic, Invocation, Maneuver, …) | pick | `pickActivatable`, `pickToggleable`, `pickedFeatureGrants` |

### Canonical examples (one per family)

```ts
// Passive numeric — Aura of Protection
{level: 6, name: /Aura of Protection/i, kind: "passive", effects: [
    {kind: "saveBonus", save: "wis", min: 2}, // +CHA mod, ≥+2 in this build
]}

// Toggle delta — Bladesong (XPHB Wizard)
{level: 3, name: /Bladesong/i, kind: "toggle", effects: [
    {kind: "togglePlusAc", expectedDelta: "+intMod"},
]}

// Passive flag — Fast Movement (Barbarian)
{level: 5, name: /Fast Movement/i, kind: "passive", effects: [
    {kind: "speed", min: 35}, // base 30 + 10, accounting for armor restriction
]}

// Pick — Sorcerer Metamagic with per-pick effect
{level: 3, name: /Metamagic/i, kind: "pick",
    pickedCount: 2, pickedFrom: TGTT_METAMAGIC,
    effects: [
        {kind: "pickActivatable", count: 2},
        {kind: "pickedFeatureGrants", pickName: /Careful Spell/i,
            subEffects: [{kind: "pickActivatable", count: 1}]},
    ]}

// Attack rider — Hexblade's Curse damage
{level: 1, name: /Hexblade's Curse/i, kind: "passive", effects: [
    {kind: "attackDamageContains", attackName: /any/, contains: /\+\s*prof/i},
]}

// Roll button — Bardic Inspiration
{level: 1, name: /Bardic Inspiration/i, kind: "passive", effects: [
    {kind: "rollAbilityCheck", ability: "cha"},
    {kind: "shortRestRestores", resource: /Bardic Inspiration/i},
]}
```

### Pick-side effects (the new mechanism)

Picks (`kind: "pick"`) get a special `pickedFeatureGrants` effect that
fires only when the named pick *actually surfaced* on the sheet. The
helper functions in `tgttFeaturePools.ts`
(`buildSpecialtyChecks`, `buildMetamagicChecks`, etc.) attach these
automatically for the auto-picker's deterministic first choice. To
add a custom one inline:

```ts
{level: 3, name: /Eldritch Invocations/i, kind: "pick",
    pickedCount: 2, pickedFrom: [/Agonizing Blast/i, /Devil's Sight/i],
    effects: [
        {kind: "pickedFeatureGrants", pickName: /Agonizing Blast/i,
            subEffects: [
                {kind: "attackDamageContains",
                    attackName: /Eldritch Blast/i, contains: /\+\s*cha/i},
            ]},
    ]}
```

If `pickName` isn't in `allFeatures` after the level-up, the sub-effects
are skipped silently — backwards-compatible with specs that don't yet
declare per-pick effects.

### When to skip with reason

Cinematic / once-per-rest narrative features have no measurable
derived effect on the sheet and should be skipped with a comment
(*not* a contrived probe):

- **Wish, Divine Intervention, Foresight, Time Stop** — too broad.
- **Capstone abilities like Perfect Self, True Polymorph at-will, Bardic 20** — flavour only.
- **"You can speak to plants / animals" type features** — flavour only.
- **Reaction-only toggles that have no derived-stat impact** — leave a comment.

The standard rejects "I couldn't think of a probe" as a skip reason.
If a feature has a documented number, damage type, advantage clause,
or roll instruction, you must probe it.

## Skip discipline

Every spec lists every check, even when skipping.  Use the `{skip: true}`
sentinel so the test report shows `test.skip(...)` with a comment
explaining why — coverage gaps **must remain visible**.

Three valid reasons to skip:

1. **Mechanic doesn't apply.**  E.g. Monk has no concentration spells →
   `concentrationCheck: {skip: true}`.  Sorcery Points restore only on a
   long rest → `shortRestRestores: {skip: true}`.
2. **Blocked by a known product bug.**  Add a `CS-BUG-NNN` entry to
   `docs/charactersheet/known-bugs.md` and reference it in the comment:
   `// blocked by CS-BUG-NNN`.
3. **Probe would be redundant.**  Rare — usually a higher-level test
   already covers it (e.g. multiclass plan-completion test covers slots).

## Cost budget

| Check | Approximate cost per spec |
|---|---|
| L1 creation | 30-45 s |
| L3 / L5 / L5-loadout | 60-180 s each |
| MEGA L1→20 | ~3 min on the fast classes, ~6 min on slow ones |
| USE probes (all) | ~30-60 s on top of the L5 build |
| Multiclass plan | 6-10 min depending on subclass picker depth |

Single-spec wall-time should stay under ~10 min.  Full suite under
~45 min on `--workers=2`.

## What "real product bug" looks like

You're looking at one when:

- The infrastructure failures from `references/troubleshooting.md` are
  ruled out.
- A focused single-class spec (e.g. just L3) reproduces it deterministically.
- The expected mechanic is documented in PHB / XPHB / TGTT and isn't
  showing up.
- Ideally: stashing all `e2e/` changes still reproduces it from a fresh
  build.

When confirmed, log it as `CS-BUG-NNN` in
`docs/charactersheet/known-bugs.md`, set the relevant probe to
`{skip: true}`, and move on.  Do **not** loosen assertions to make a
test go green over a product bug.

## Coverage audit script

Run before opening a PR that adds or modifies a TGTT spec:

```sh
node scripts/auditE2eCoverage.mjs
```

This walks every `test/e2e/specs/tgtt-*.spec.ts`, counts hand-written
`featuresMatrix` entries, and reports per-spec EffectCheck coverage:

```
spec=tgtt-foo entries=N effects=M helpers=K reason=R skip=S cov=M/N status
```

- `effects` = explicit `effects: [...]` blocks attached to entries.
- `helpers` = number of `build*Checks` helpers used (each helper
  attaches per-pick `pickedFeatureGrants` automatically).
- `reason` = `// no measurable …` comments justifying existence-only
  rows (cinematic features, capstones, narrative flavor).
- `skip` = `{skip: true, skipReason: ...}` probes anchored to a
  CS-BUG-NNN entry.

Specs at < 80% effective coverage flag as **LOW** — either backfill
effect probes for measurable features, or add explicit `// no
measurable …` comments documenting why a row is existence-only.  The
script is advisory by default; pass `--strict` to make it exit
non-zero on any LOW spec (use in CI gates).

## Post-test JSON export (automatic)

Every generated test (single-class L1 / L3 / L5 / L5-loadout / MEGA /
USE / round-trip, plus the multiclass plan test) dumps the final
`cs._state.toJson()` to:

```
test-results/exports-for-validation/<displayName-slug>/<testInfo.title-slug>--<status>.json
```

on **both pass and fail**. Implemented in
[`characterSpecFactory.ts`](../../../../test/e2e/utils/characterSpecFactory.ts)
as `_exportCharacterForValidation`, registered as the
last-registered `afterEach` in both `describeCharacter` and
`describeMulticlassCharacter` so Playwright's LIFO afterEach order
runs the export **before** `clearHomebrewStorage` wipes IndexedDB
(without that order the read-through returns `null`).

Properties of the drop:

- `status` is one of `passed` / `failed` / `timedOut` / `interrupted` /
  `skipped`. Skipped tests still write a tiny stub
  `{status:"skipped"}` so the absence of a file is unambiguous when
  triaging coverage gaps.
- Payload wraps the raw `toJson()` under `character` plus metadata
  (`status`, `displayName`, `title`, `duration`, `retry`, `errors`,
  `exportedAt`) for triage.
- Failures inside the export are logged and swallowed — the export
  **never** turns a green test red.
- `test-results/` is already gitignored.

Spec authors get the artifact for free; no code changes required.
Use it to manually load a build into the live character sheet (or
diff two runs) when the suite-side probes can't cover the question
(visual rendering, fluff text, layout, art).

## See also

- [`spec-template.md`](spec-template.md) — copy-paste template + 10-step authoring checklist.
- [`page-objects.md`](page-objects.md) — page-object API reference.
- [`factory-tests.md`](factory-tests.md) — how `CharacterSpec` becomes tests.
- [`troubleshooting.md`](troubleshooting.md) — diagnosing infra vs product failures.
