# Spawning Test Characters

Reproducing a character-sheet bug used to mean walking two wizards by hand: the
Builder for level 1, then Quick Build for every level after that. Dozens of
clicks, several minutes, and a fresh round of clicking every time you wanted to
re-test after a fix.

The **spawner** collapses that to one line:

```js
await charSheet.spawn("cleric/tempest/9/dwarf");
```

## Why this exists

Three problems, one mechanism:

1. **Slow iteration.** Building a level-9 Tempest Cleric by hand is minutes of
   clicking. A spawn takes about two seconds.
2. **Stale characters.** A character built *before* a fix does not contain that
   fix — its state was written by the old code. Re-testing on it is misleading.
   Because spawning is nearly free, the answer is to always test on a fresh
   character rather than to attempt a risky in-place rebuild (hand-added feats,
   custom abilities and modifiers make in-place rebuilds unsafe).
3. **Handing a repro to someone else.** A spec string is a complete, durable
   description of a starting character. Paste it into a bug report and anyone —
   human or LLM — can reproduce your character exactly.

> **The spawner drives the real engines.** It renders the actual Builder and
> Quick Build controls and operates them, and calls the same `_applyCurrentStep()`
> / `_applyQuickBuild()` code a player's clicks would. It contains **no parallel
> build logic**. Every fix to the wizards is therefore automatically exercised by
> every spawn, and the spawner cannot drift into a test-only build path.

## Spec format

### Short DSL

```
class/subclass/level/race
```

| Spec | Meaning |
|------|---------|
| `cleric` | Cleric 1, everything else auto-picked |
| `fighter/9` | Fighter 9 (numeric second segment = level) |
| `cleric/tempest/9/dwarf` | Level 9 Tempest Cleric, Dwarf |
| `rogue//1/halfling` | Rogue 1, Halfling, subclass auto-picked |
| `fighter/champion/5+warlock/fiend/3` | Multiclass, `+` separates legs |

Names are matched loosely — `tempest` finds "Tempest Domain", `evocation` finds
"School of Evocation". An unmatched name fails loudly with suggestions rather
than silently building something else.

### Object form

Anything the DSL can't express (per-choice overrides, sources, backgrounds,
explicit ability scores) goes in the object form, accepted by the console API,
the CLI, and `?spawnJson=`:

```js
await charSheet.spawn({
    classes: [{name: "Cleric", subclass: "Tempest Domain", level: 9}],
    race: "Dwarf",
    subrace: "Hill Dwarf",
    background: "Acolyte",
    abilities: {str: 10, dex: 12, con: 14, int: 8, wis: 17, cha: 13},
    seed: "repro-1",
    name: "Bug 1234",
    choices: {
        optionalFeatures: {"FS:F": ["Defense"]},
        spells: ["Spirit Guardians", "Banishment"],
        cantrips: ["Guidance"],
        options: {"Divine Order": ["Thaumaturge"]},
    },
});
```

## Choice policy

Every choice the wizards would ask about is resolved by one of three sources, in
order:

1. **A spec override** — wins, and is consumed once (list two entries to fill two
   slots).
2. **The class ability priority**, for ability allocations (racial `+2/+1`, ASI).
   A Warlock will not put its racial `+2` into Wisdom just because Wisdom is a
   save proficiency.
3. **The source preference**, for option pools that carry an explicit source. A
   spawned character draws from PHB / XPHB / TGTT plus whatever books its own
   class, subclass, race and background come from — so a Rogue masters a Dagger
   instead of an XDMG Laser Rifle. If honouring the preference would leave too
   few options to fill the slots, the full pool is used instead.
4. **A seeded pick.** The seed defaults to a stable hash of the spec itself, so
   *the same spec always produces the same character.* Pass `seed: "anything"`
   for a different-but-reproducible variant, or `seed: "random"` for variety.

Steps 2 and 3 exist because a *plausible* character is the whole point: a test
character whose ability scores or weapons are nonsense is one you cannot use to
check an attack roll. Both are overridable by step 1.

## The choice report

Every spawn returns a report and logs it to the console:

```
Spawn: cleric/tempest/9/dwarf  (seed: …, 1936ms)
  base
    - subclass[Cleric]: Tempest Domain (spec)
    - background: Lorwyn Expert (auto)
    - option[Feat Selection]: Artificer Initiate (auto)
    …
  L1
    - option[Divine Order]: Thaumaturge (auto)
    - cantrip: Guidance (auto)
```

| Member | Use |
|--------|-----|
| `report.isClean` | `true` when nothing was left unresolved |
| `report.unresolved` | Choices the spawner could not satisfy |
| `report.unhandledPrompts` | Modals it did not recognise (see below) |
| `report.toPinnedSpec()` | The spec with **every** auto-pick written out explicitly |
| `report.toText()` / `report.toJson()` | Printable / machine-readable forms |

`toPinnedSpec()` is how a random spawn that found a bug becomes an exact
reproduction: spawn with `seed: "random"` until the bug appears, then pin it.

Any modal the spawner does not recognise is recorded as an **unhandled prompt**
and dismissed, rather than hanging the spawn. That turns a coverage gap into a
loud, fixable report line instead of a half-built character.

## The four surfaces

### 1. UI — right-click "New Character"

Right-clicking the **New Character** button opens the spawn dialog: class,
subclass, species, background, level, seed and name, with a live spec preview
and **Randomise**, **Copy URL**, **Copy spec** and **Spawn** buttons.

This replaced the old right-click "random character" generator, which was a
~450-line parallel build path that wrote straight to state, only ever produced
level-1 characters, and never reflected fixes to the wizards.

### 2. URL

```
charactersheet.html?spawn=cleric/tempest/9/dwarf
charactersheet.html?spawn=fighter/champion/5&seed=abc&name=Repro&save=0
charactersheet.html?spawnJson=<url-encoded JSON spec>
```

Extra convenience params: `&race=`, `&subrace=`, `&background=`.
`save=0` spawns without persisting to local storage.

**This is the form to paste into a bug report.**

### 3. Console

```js
await charSheet.spawn("cleric/tempest/9/dwarf");          // build it
await charSheet.spawn(spec, {seed: "random", save: false});
charSheet.lastSpawnReport().toText();                     // what did it pick?
await charSheet.respawn();                                // same spec, today's code
csSpawn("wizard/evocation/5");                            // shorthand
```

`respawn()` builds a **new** character from the current one's stored spec. It
never mutates the existing character — comparing old against new is how you
answer "did the fix actually land?".

### 4. CLI

```bash
npm run spawn -- "cleric/tempest/9/dwarf"
npm run spawn -- "fighter/champion/5+warlock/fiend/3" --seed 42 --out char.json
npm run spawn -- --file specs.txt --out-dir out/ --strict
```

Boots the same static server the e2e suite uses and spawns headlessly. A one-line
summary always goes to stderr; what lands on **stdout** depends on how you ran it:

| Situation | stdout |
| --- | --- |
| Interactive terminal | The readable choice report |
| Piped or redirected | `{spec, report, character, summary}` JSON — so `\| jq` works |
| `--json` | Forces the JSON dump |
| `--out file.json` / `--out-dir dir/` | Written to disk instead |

A full character is tens of thousands of lines of rendered HTML, hence the split.
`--strict` exits non-zero when any spawn left a choice unresolved, so a spec list
can gate CI. `--quiet` silences the per-spec summary.

## Handing a repro to an LLM

Include the URL and the pinned spec:

> Load `charactersheet.html?spawn=cleric/tempest/9/dwarf`. Channel Divinity shows
> 1 use instead of 2. Re-test by reloading the same URL after your fix — the
> spawner rebuilds from scratch through the real engines, so a stale character
> can't mask the result.

Pin the spec first (`charSheet.lastSpawnReport().toPinnedSpec()`) if the bug
depends on a specific auto-picked feat, invocation or spell.

## Anti-staleness

Each spawned character stores its spec, seed and resolved choices in
`_data.spawn` (`state.getSpawnMeta()`), which survives save/load. That is what
`respawn()` reads. Spawned characters are marked so they are never confused with
hand-built ones.

## Implementation

| File | Role |
|------|------|
| `js/charactersheet/charactersheet-spawn.js` | Spec parsing, seeded RNG, the choice picker, name resolution, the report |
| `js/charactersheet/charactersheet-spawn-prompts.js` | Auto-answers `_pPickFeatureChoice`, the spell pickers and `InputUiUtil.*`; watchdogs unknown modals |
| `js/charactersheet/charactersheet-spawn-autofill.js` | Operates wizard controls generically (see below) |
| `js/charactersheet/charactersheet-spawn-drivers.js` | Builder driver, Quick Build driver, `CharacterSheetSpawner` orchestrator |
| `scripts/spawnCharacter.mjs` | The CLI |

### Why the autofill layer exists

The Builder enumerates its option pools *inside* its ~60 `_render*` methods, not
in reusable helpers. Re-deriving those pools outside the wizard would be exactly
the parallel build path this feature exists to remove. So the spawner renders the
real controls into the real (hidden) containers and operates them — programmatic
`.click()` runs the wizard's own handlers and, by construction, offers exactly
the pool a player sees.

Empirically the whole wizard surface is covered by eight control shapes:

1. Checkbox groups with a `Selected: n/max` counter.
2. Quick Build `.charsheet__quickbuild-option` rows (`selected` class, optional
   `n/m` badge).
3. Point pools (`Points remaining: N` plus `+` buttons).
4. Spell pickers (`.charsheet__spell-picker-*`, separate cantrip/spell counters).
5. `<select>` elements sitting on an empty placeholder.
6. Radio groups.
7. Toggle-button grids under a `Choose N …:` label (feat tools/skills/languages).
8. `+ Add …` buttons that open a picker modal.

Two rules keep this robust, both learned from real breakage:

- **Re-find targets by name between clicks.** Handlers call `replaceWith()` /
  re-render, so held element references go stale.
- **Never touch a filter control.** Only `<select>`s whose placeholder reads like
  a choice (`-- Select --`, `Choose…`) are filled; a filter reading "All Levels"
  is left alone, because narrowing a spell picker's filter makes its remaining
  slots unfillable.

## Tests

| Suite | Covers |
|-------|--------|
| `test/jest/charactersheet/CharacterSheetSpawnCore.test.js` | Spec parsing, DSL round-trip, seeded RNG, name resolution, report pinning |
| `test/jest/charactersheet/CharacterSheetSpawnPrompts.test.js` | Override precedence, ability-priority allocation, source preference, prompt interception |
| `test/e2e/specs/spawn.spec.ts` | A build matrix, multiclass, determinism, pinned-spec replay, the `?spawn=` URL, `respawn()`, and bad-input handling — all asserting **zero** unresolved choices |

Run them with:

```bash
npm run test:unit -- CharacterSheetSpawn
npx playwright test test/e2e/specs/spawn.spec.ts
```

## Limits

- The spawner is **not** a replacement for the comprehensive `tgtt-*` e2e specs.
  Those must keep driving the wizard UI by hand — that is what they test.
- Coverage of bespoke TGTT pick types grows incrementally. When the spawner meets
  a control it doesn't recognise it says so in `report.unresolved` /
  `report.unhandledPrompts`; that is the signal to add a fill mode.
- Equipment and starting gold follow the wizards' defaults; the spec has no
  inventory section yet.
