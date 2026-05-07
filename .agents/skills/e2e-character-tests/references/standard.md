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
| 19 | **TGTT Specialties: cumulative pick coverage** *(new)* | per-spec `featuresMatrix` via `buildSpecialtyChecks(className)` | Every TGTT class grants cumulative "Specialties" picks at fixed levels (Fighter 1/5/9/13/17, Monk 2/4/…, Cleric 3/7/…, etc.). Each milestone must assert ≥N distinct specialty names land on the sheet, drawn from the class's L1 pool. |
| 20 | **Weapon Mastery: pickedFrom + rollAttack** *(new, martials)* | per-spec `featuresMatrix` `pick` with `rollAttack` effect | XPHB martials (Fighter, Barbarian, Ranger, Paladin, Rogue, Monk where applicable) gain Weapon Mastery at L1. The picked weapons must surface as attacks and roll without throwing. |
| 21 | **Battle Tactics / class-option pickers** *(new, Fighter/etc.)* | per-spec `featuresMatrix` `pick` with `pickActivatable` effect | Fighter Battle Tactics (2 at L3, +1 at L7/10/15), Sorcerer Metamagic, Warlock Invocations, Battle Master Maneuvers, Eldritch Knight spells, Arcane Shot options — each must register the picked option as a feature on the sheet. |

## Helpers for class-option pickers

For TGTT classes, use the shared pools in
[`test/e2e/utils/tgttFeaturePools.ts`](../../../test/e2e/utils/tgttFeaturePools.ts):

- `TGTT_SPECIALTIES[className]` — per-class regex pool of specialty names.
- `TGTT_SPECIALTY_LEVELS[className]` — class-levels at which a new
  specialty pick is granted (used to build cumulative `pickedCount`).
- `buildSpecialtyChecks(className, levelMap?)` — returns a ready-made
  `FeatureCheck[]` list of cumulative `kind: "pick"` entries for every
  specialty milestone. Spread it into your `featuresMatrix`:

  ```ts
  import {buildSpecialtyChecks} from "../utils/tgttFeaturePools";

  const FOO_FEATURES_MATRIX: FeatureCheck[] = [
      // … class-specific entries …
      ...buildSpecialtyChecks("Fighter"),
  ];
  ```

  For multiclass specs, pass a `levelMap` mapping class-level → spec
  character-level so the matrix targets the right characterLevel.

- `TGTT_BATTLE_TACTICS` / `TGTT_BATTLE_TACTICS_CUM` — Fighter Battle
  Tactics pool and cumulative count per class-level (3→2, 7→3, 10→4,
  15→5).

Pools are auto-derived from `homebrew/TravelersGuidetoThelemar.json`;
regenerate when homebrew changes.

## Skip discipline (continued)

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

## See also

- [`spec-template.md`](spec-template.md) — copy-paste template + 10-step authoring checklist.
- [`page-objects.md`](page-objects.md) — page-object API reference.
- [`factory-tests.md`](factory-tests.md) — how `CharacterSpec` becomes tests.
- [`troubleshooting.md`](troubleshooting.md) — diagnosing infra vs product failures.
