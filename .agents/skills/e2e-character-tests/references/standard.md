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

## See also

- [`spec-template.md`](spec-template.md) — copy-paste template + 10-step authoring checklist.
- [`page-objects.md`](page-objects.md) — page-object API reference.
- [`factory-tests.md`](factory-tests.md) — how `CharacterSpec` becomes tests.
- [`troubleshooting.md`](troubleshooting.md) — diagnosing infra vs product failures.
