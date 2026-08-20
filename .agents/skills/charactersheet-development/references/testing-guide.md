# Testing Guide

## Contents
- Test Infrastructure (directory, setup, running tests, import pattern, setup.js mocks)
- Test Categories (state, class-specific, combat, spells, parsers, toggle, TGTT, integration, builder, levelup, misc)
- Writing Tests: Patterns (standard feature, toggle ability, multiclass, spells, inventory, active states)
- Anti-Patterns to Avoid
- Test File Conventions

## Test Infrastructure

### Directory & Setup

- Tests: `test/jest/charactersheet/*.test.js` (65+ files)
- Setup: `test/jest/charactersheet/setup.js` (auto-loaded via Jest config)
- Config: `jest.config.json` at project root

### Running Tests

```bash
# Single file
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetBarbarian --no-coverage --forceExit

# Multiple related suites
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetToggleAbilities CharacterSheetCombat --no-coverage --forceExit

# All character sheet tests
NODE_OPTIONS='--experimental-vm-modules' npx jest test/jest/charactersheet/ --no-coverage --forceExit

# Pattern match
NODE_OPTIONS='--experimental-vm-modules' npx jest -t "Rage damage" --no-coverage

# With coverage
NODE_OPTIONS='--experimental-vm-modules' npx jest test/jest/charactersheet/ --coverage

# Verbose
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetState --no-coverage --verbose
```

`--forceExit` is recommended — some tests hang without it due to async cleanup.

### Getting a character to test against

Do not hand-build characters for manual testing or bug repro. Spawn them:

```bash
# In the browser console, or a Playwright evaluate():
await charSheet.spawn("cleric/tempest/9/dwarf");

# By URL (the form to paste into a bug report):
charactersheet.html?spawn=fighter/champion/5+warlock/fiend/3

# From the shell (headless, prints {spec, report, character}):
npm run spawn -- "wizard/evocation/5/gnome"
```

The spawner drives the real Builder and Quick Build engines, so a spawned
character always reflects the current code — which is the fix for the
"the fix isn't in my previously-built character" confusion. `charSheet.respawn()`
rebuilds the current character's spec as a NEW character (never in place).

Full reference: `docs/charactersheet/15-spawn-test-characters.md`.

### The Import Pattern

Character sheet modules use browser globals. Tests must import explicitly:

```javascript
// setup.js provides: Parser, MiscUtil, CryptUtil, Renderer, UrlUtil, StorageUtil, RollerUtil

// Import the module — it assigns to globalThis
import "../../../js/charactersheet/charactersheet-state.js";

// Grab from globalThis
const CharacterSheetState = globalThis.CharacterSheetState;
```

**Critical**: If `charactersheet-state.js` calls `CharacterSheetClassUtils` (or any other module), you must import that module BEFORE in the test file:

```javascript
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
const CharacterSheetState = globalThis.CharacterSheetState;
```

Otherwise you'll get `ReferenceError: CharacterSheetClassUtils is not defined`.

**The dangerous variant is the one that does NOT throw.** Some cross-module calls are wrapped in
a `typeof X === "undefined"` guard so the sheet degrades gracefully when a module is absent. In a
test, that guard turns a missing import into a **silent no-op** instead of an error:

```javascript
// charactersheet-state.js
projectItemMaterial (itemData) {
    if (typeof CharacterSheetMaterials === "undefined") return itemData;  // ← silent
    ...
}
```

A test that imports only `charactersheet-state.js` and then sets a material gets a populated
catalog, a successful `setItemMaterial`, and an item whose `dmg1` never moves — indistinguishable
from "this material has no effect". Known guarded pairs:

| Caller | Guarded on | Silently skips |
|---|---|---|
| `projectItemMaterial` | `CharacterSheetMaterials` | the entire material projection |
| `getEffectiveItemBonuses` | `CharacterSheetMaterials` | material tags, crit dice, rider effects |
| `getEffectiveItemBonuses` | `CharacterSheetUpgrades` | every upgrade effect, incl. `damageDieIncrease` |

This has already produced a vacuous test that shipped: a case titled *"tracks a material die
step"* asserted no die step, and rationalised the flat result in a comment rather than finding
the missing import. **If a test asserts that a module changes something, assert the changed
value, and confirm the test fails when the import is removed.**

### What setup.js Mocks

| Global | Mocked Methods |
|--------|---------------|
| `Parser` | `ABIL_ABVS`, `ATB_ABV_TO_FULL`, `SRC_PHB`, `SRC_XPHB`, `attAbvToFull()`, `getAbilityModNumber()`, `spLevelToFull()`, `sourceJsonToAbv()`, `getOrdinalForm()` |
| `MiscUtil` | `copyFast()`, `copy()`, `getProperty()`, `setProperty()` |
| `CryptUtil` | `uid()`, `md5()`, `hashCode()` |
| `Renderer` | `get()` returning `{render(), recursiveRender()}` |
| `StorageUtil` | `pGetForPage()`, `pSetForPage()`, `getForPage()`, `setForPage()` |
| `UrlUtil` | `autoEncodeHash()`, `PG_SPELLS`, `PG_ITEMS` |
| `RollerUtil` | `isCrypto()` |
| `String.prototype` | `toTitleCase()` |

If you need an additional Parser or Renderer method, add it to setup.js with a minimal mock implementation.

## Test Categories

| Category | Files | What They Test |
|----------|-------|---------------|
| **State** | `CharacterSheetState.test.js` | Core getters/setters, ability scores, HP, saves, skills |
| **Class-specific** | `CharacterSheetBarbarian.test.js`, etc. | Class features via `getFeatureCalculations()` |
| **Combat** | `CharacterSheetCombat.test.js`, `...CombatActionEconomy`, `...CombatSneakAttack` | Attack math, conditions, death saves |
| **Spells** | `CharacterSheetSpells.test.js`, `...SpellEffects`, `...SpellAutomation`, `...SpellSystem`, `...RitualCasting` | Spell slots, DC, casting |
| **Parsers** | `CharacterSheetParsers.test.js`, `...FeatureParsing` | Text parsing for features |
| **Toggle/States** | `CharacterSheetToggleAbilities.test.js`, `...ActiveStateEngine`, `...ActiveEffects` | Active states, stacking, mutual exclusivity |
| **TGTT** | `CharacterSheetTGTT*.test.js` (8 files) | Thelemar homebrew content |
| **Integration** | `CharacterSheetIntegration.test.js`, `...BugFixes`, `...EdgeCases` | End-to-end workflows |
| **Builder** | `CharacterSheetBuilderASI.test.js`, `...BuilderFeatureIngestion`, `...QuickBuildApply` | Character creation |
| **LevelUp** | `CharacterSheetLevelUp.test.js`, `...LevelHistory`, `...MulticlassProgression` | Level progression |
| **Misc** | `CharacterSheetInventory`, `...Rest`, `...Conditions`, `...Exhaustion`, `...NpcExporter`, etc. | Individual systems |

## Writing Tests: Patterns

### Standard feature test

```javascript
describe("Battle Master", () => {
    let state;
    beforeEach(() => { state = new CharacterSheetState(); });

    it("should have 4 superiority dice at level 3", () => {
        state.addClass({name: "Fighter", source: "PHB", level: 3, 
            subclass: {name: "Battle Master", source: "PHB"}});
        const calc = state.getFeatureCalculations();
        expect(calc.superiorityDice).toBe(4);
        expect(calc.superiorityDie).toBe("d8");
    });

    it("should scale superiority die to d10 at level 10", () => {
        state.addClass({name: "Fighter", source: "PHB", level: 10, 
            subclass: {name: "Battle Master", source: "PHB"}});
        const calc = state.getFeatureCalculations();
        expect(calc.superiorityDie).toBe("d10");
    });
});
```

### Toggle ability test

```javascript
describe("Rage activation", () => {
    let state;
    beforeEach(() => {
        state = new CharacterSheetState();
        state.addClass({name: "Barbarian", source: "PHB", level: 1});
    });

    it("should grant B/P/S resistance while raging", () => {
        state.activateState("rage");
        const activeEffects = state.getActiveStateEffects();
        expect(activeEffects.some(e => e.type === "resistance" && e.target === "damage:bludgeoning")).toBe(true);
    });
});
```

### Multiclass test

```javascript
it("should combine spell slots for multiclass full casters", () => {
    state.addClass({name: "Wizard", source: "PHB", level: 3});
    state.addClass({name: "Cleric", source: "PHB", level: 2});
    // Combined caster level 5 → 4/3/2 slots
    expect(state.getSpellSlots(3)).toBe(2);
});
```

### Testing with spell data

Spells in state use this format (see [Subsystem Details](./subsystem-details.md) for full schema):
```javascript
state.addSpellKnown({
    name: "Fireball", source: "PHB",
    prepared: false, concentration: false, ritual: false
});

// Innate spells have additional fields:
state.addInnateSpell({
    name: "Misty Step", source: "PHB", innate: true,
    uses: {current: 1, max: 1}, recharge: "long",
    sourceFeature: "Fey Step"
});
```

### Testing with inventory items

```javascript
state.addInventoryItem({
    item: {name: "Longsword +1", source: "DMG", type: "M", bonusWeapon: "+1"},
    quantity: 1, equipped: true, attuned: true
});
```

### Testing active states

Ability score BASE and BONUS are separate:
```javascript
state.setAbilityScore("str", 16);   // Sets base
state.setAbilityBonus("str", 2);    // Sets racial/item bonus
expect(state.getAbilityScore("str")).toBe(18); // base + bonus
expect(state.getAbilityMod("str")).toBe(4);    // (18-10)/2
```

## Anti-Patterns to Avoid

| Anti-Pattern | Why It's Bad | Correct Approach |
|-------------|-------------|-----------------|
| `expect(state.getTotalLevel()).toBe(3)` | Always passes, verifies nothing | Use `getFeatureCalculations()` |
| Testing feature presence with string matching | Brittle, doesn't test mechanics | Assert on computed values |
| Huge test bodies with no beforeEach | Hard to read, brittle | Extract setup to beforeEach |
| Not importing dependencies | ReferenceError in CI | Import all needed modules |
| Mutating state without isolation | Tests leak between each other | Use `beforeEach` for fresh state |
| Reading `_data.abilities.str` directly | Gets base only, not total | Use `getAbilityScore()` (base+bonus) |
| Not matching source in spell assertions | Blade Ward behaves differently by edition | Always check name AND source |
| `SomeClass._method = () => []` with no restore | Permanent static clobber -- every test declared *after* it silently runs against the stub | Capture the original, restore in `afterEach`, and add a tripwire (below) |
| `state._data.namedModifiers.push({...})` **then asserting a total** | Bypasses `_recalculateCustomModifiers()`, so the value never reaches the cache the total getters read | Use `addNamedModifier()`, or recalc after the push. Raw push is correct for `getModifiersForType`/`aggregateModifiers` (below) |
| Naming a test after a gate without checking the fixture reaches it | The test passes whether the gate exists or not, and its *name* is what stops anyone re-checking | Delete the gate and run. Zero red means the test's name is the only thing testing it (below) |

### Replacing a static is a false-green generator

A bare `CharacterSheetNpcExporter._getEquippedArmorMaterialNotes = () => [];` inside one
test is not scoped to that test. It replaces the static for the rest of the file, so every
later test runs against the stub and keeps passing -- while checking less than it claims.

This is expensive to diagnose because it presents as **order-dependence**: the test passes
under `-t "name"` (the clobbering test is skipped) and fails in the full-file run. The
natural next step -- instrumenting everything the function reads -- is a dead end, because
the inputs really are all correct. The thing that changed is the callee.

It also fails *quietly in the safe direction*. In one real case the leak had disarmed the
armour half of a matrix invariant: the test passed, but disabling the production guard it
was supposed to catch failed only one test instead of two.

```js
let _restore = null;
function silenceChannel () {
    const original = Cls._method;
    Cls._method = () => [];
    _restore = () => { Cls._method = original; };
}

// Captured before any test runs.
const _PRISTINE = Object.freeze({_method: Cls._method, _other: Cls._other});

afterEach(() => {
    if (_restore) _restore();
    _restore = null;
    // Attribution: fails ON the leaking test, not on an innocent one 500 lines later.
    Object.entries(_PRISTINE).forEach(([k, fn]) => expect(Cls[k]).toBe(fn));
});
```

Prefer `jest.spyOn(Cls, "_method").mockReturnValue([])` with `restoreAllMocks`, which gets
this right by construction. The manual form above is for statics a spy cannot reach.

### A raw `namedModifiers` push passes through **two** silent gates

There are two reader families and two gates, and a bare `.push()` of a minimal object
satisfies neither family. Prefer **`addNamedModifier()`**, which clears both.

**Gate 1 -- `enabled`.** Both families skip a modifier that is not enabled:
`_recalculateCustomModifiers()` at `charactersheet-state.js:52585` (`if (!mod.enabled) return;`)
and `getModifiersForType()` at `:53250` (`if (!mod.enabled && !mod.conditional) return;`).
`addNamedModifier()` sets `enabled: modifier.enabled !== false`; an object literal does not.
Note the aggregate carve-out: a **`conditional`** modifier is admitted while disabled, because
text-parsed conditionals are registered `enabled: false` on purpose (CS-BUG-053).

**Gate 2 -- the recalc.** Total/value getters read a *cache*. `_recalculateCustomModifiers()`
folds `_data.namedModifiers` into `_data.customModifiers`, and `getSkillMod()` /
`getAbilityCheckCustomMod()` read the fold. `addNamedModifier()` triggers it; a bare `.push()`
does not. Aggregate getters walk the array directly and so do not need it.

Measured on `skill:perception` with `value: 5`, varying only the delivery:

| injection | `getSkillMod()` (total) | `getModifiersForType()` (aggregate) |
|---|---|---|
| `.push({type, value})` + recalc | `0 -> 0` **inert** | `0 -> 0` **inert** |
| `.push({enabled: true, ...})`, no recalc | `0 -> 0` **inert** | `0 -> 1` live |
| `.push({enabled: true, ...})` + recalc | `0 -> 5` live | `0 -> 1` live |
| `addNamedModifier({type, value})` | `0 -> 5` live | `0 -> 1` live |
| `.push({enabled: false, conditional})` | `0 -> 0` | `0 -> 1` live |
| `.push({enabled: false, conditional})` + recalc | `0 -> 0` | `0 -> 1` live |

So: **the recalc is required only by totals, and `enabled: true` is required by totals
unconditionally but by aggregates only for a non-conditional.** The last two rows are the
carve-out, and the asymmetry in them is deliberate rather than a bug to route around: a
conditional is *surfaced* for a per-roll opt-in, and must never silently move a printed number.
No recalc will promote it, so reaching for one is the wrong repair twice over.

All 15 raw-push sites in the suite already pass `enabled: true`, which is why they are sound --
the hazard is writing a *new* one from a minimal object. A corollary worth stating because it
is the natural wrong repair: **do not "fix" a bare push by adding the recalc.** Without
`enabled` it stays inert in *both* columns, and the recalc makes it look like a fix was applied.

All six rows are pinned executably in
`CharacterSheetModifierReachability.test.js` -> `describe("the two gates a raw namedModifiers
push has to clear")`. That test, not this table, is the authority: this matrix is a transcription
and a transcription cannot fail when the gates move. The same matrix is also described in
`subsystem-details.md`; if you change one prose copy, the test is what tells you the other is now
wrong.

The trap is not the flat run -- it is what a flat run tempts you to conclude. A raw push was
read once as evidence that `namedModifiers` typed `skill:<name>` is "inert for numeric purposes"
and that `customModifiers.skills` is a separate, value-bearing channel. They are **the same
channel**: `namedModifiers` -> recalc -> `customModifiers.skills` -> `getSkillCustomMod()` ->
`getSkillMod()` (`:52650`, and the getter says so at `:11318`). `customModifiers` is the cache,
not a rival input. There are ~90 `skill:<name>` registrations in `js/`; every one works.

**Two sessions described this gate one turn apart and each named only the gate its own probe
happened to trip.** Neither swept the dimensions before writing the rule down -- and the second
description was committed as guidance, which is how a half-measured mechanism becomes the
instruction that manufactures the next vacuous test. Enumerate what the gate reads *before*
describing it, and vary each dimension independently.

**A carve-out in the code under test can hide a gate from the suite that tests it.** Deleting
`enabled: true` from the `withModifier` helper reds only **3 of 49** reachability tests -- the
`conditional: null` ones. The other 46 pass because the modifier they build is conditional, and
`getModifiersForType` deliberately admits a *disabled conditional*. So 46 tests are insensitive
to gate 1 by construction, and a suite-wide vacuity is held off by three assertions. When a
reader has a documented exemption, make sure something probes the **unexempted** path, or the
exemption quietly becomes the only path you test.

**A control that fails to move invalidates the measurement. It does not explain itself.**
Reaching for the mechanism that would justify a flat control is how a dead probe becomes a
false fact about the codebase -- the same evidence that says "don't trust this run" reads,
if you squint, like "and here is why", and the second reading is unearned. Fix the probe
until the control moves, *then* interpret.

### A guard can be blind to its own name because of call *order*

`CharacterSheetMaterialCatalogResolution.test.js` carried a test called *"keeps complaining when the
catalog arrives but still lacks the material"*. It seeded the catalog, then resolved a bad
reference, then asserted the complaint was recorded. It passed for months.

The bug it was named for is that `setItemMaterialCatalog` **clears** the record. So the record is
only ever at risk when a catalog installs *after* it exists -- which that ordering never does. The
test asserted "a bad reference gets recorded", which was never in doubt; it read as though it
asserted "a bad reference survives", which was false. A wholesale clear was destroying genuine
faults and the guard could not see it.

Proof it was structural rather than lucky: under the mutation that restores the wholesale clear,
the old test **stays green** and only the new orderings go red.

**When a guard protects state against a destructive event, the event must happen after the state
exists.** Ask what the failure mode needs in order to occur -- usually an ordering, a second call,
or a reload -- and write *that* sequence. A setup-then-assert shape tests construction; it cannot
test survival. The same applies to caches, dedupe sets and any "clear on X" path: exercise X at
least once after the thing you expect to persist.

### The `itemId` accessors now say so when you hand them an item

Three of the failed controls described above had **one** cause: an accessor that takes an
`itemId` was called with the *item*. `find(i => i.id === itemId)` matches nothing, and the
caller gets `{}` or `null` -- indistinguishable from "this character has no such item". No
error, no clue, and the empty result reads as a finding about the code.

`getEffectiveItemBonuses` and `getItemRaw` now warn (once per method, never throw) and name the
correction. The rest of the family routes through one of those two.

If you are writing a probe against an item, the shape is `accessor(row.id)`, not `accessor(row)`
and not `accessor(row.item)`. And when a probe comes back empty, **check the call before you
believe the result** -- that is what all three occurrences had in common.

### A fixture on the wrong side of a gate does not, by itself, test that gate

The obvious rule is *a gate is only under test if some fixture is on the wrong side of it* —
line coverage cannot tell "the branch executed" from "a fixture the branch rejects exists".
That rule is necessary but **not sufficient**, and materials has the counterexample.

`_matchesTrigger` (`charactersheet-materials.js:896`) guards two disjoint trigger shapes:

```js
if (t.on === "attackRoll") {
    if (trigger.type !== "attackRoll") return false;   // :900
    if (Array.isArray(t.natural) && t.natural.includes(Number(trigger.natural))) return true;
```

`CharacterSheetMaterialInstability.test.js` already carried a test **named after that gate** —
*"does not fire a natural-1 instability on a damageTaken trigger"* — and a Magmaheart leg
doing the mirror. Both stay green with the gate deleted. Measured against the whole suite:
**17,130 tests, zero red**, for either gate.

The reason is that the check *after* the gate independently rejects a **plain** cross-type
trigger. A `damageTaken` event carries no `natural`, so `includes(Number(undefined))` is
false anyway; an `attackRoll` carries no `damageType`, so the string compare fails anyway.
The fixture really is on the wrong side, and it flows through a gate that happens to be
redundant *for that input*.

> **A fixture on the wrong side of a gate tests it only if the code after the gate would
> answer differently.** Otherwise it passes through a redundant gate and is green either way.

The discriminating fixture is an **enriched** cross-type trigger — one carrying the *other*
shape's field. With the gates removed, both of these flip to `true`:

```js
// Stormprism fires on a natural 1; this is a damage event that happens to carry one.
isInstabilityTriggered(stormprism, {type: "damageTaken", damageType: "lightning", natural: 1})
// Magmaheart bites when its carrier TAKES cold damage, not when they swing a cold weapon.
isInstabilityTriggered(magmaheart, {type: "attackRoll", natural: 7, damageType: "cold"})
```

Pinned in `describe("the cross-type trigger gates, pinned with a fixture that can reach them")`.

**Latent, not live.** All three trigger construction sites in product code
(`charactersheet-combat.js:1915`, `:1962`, `charactersheet.js:12524`) build the disjoint
shapes promised by the docstring at `charactersheet-materials.js:840`. The shapes are held
apart by a *comment*; these gates are what stands behind it if either ever gains a field.

The practical procedure, since the reasoning is hard to do by inspection: **delete the gate
and run the suite.** Zero red means no fixture reaches it, whatever the test names claim.

### Your suite is smaller on a clean checkout than it is on your machine

`npm test` here runs **17,120** tests. On a fresh clone it runs **16,359**. The 759-test gap is
almost entirely `CharacterSheetNpcExporter.realsaves.test.js`, which walks a corpus of real
character saves in `npc-exports/` -- an **untracked, local-only** directory. The suite filters it
with `existsSync` and degrades to a documented skip when it is absent, which is the right
behaviour; the hazard is that nothing in a green run tells you which of the two numbers you got.

Two consequences worth holding on to:

- **A green run is not a fixed amount of evidence.** Before concluding that a change is safe
  because the suite passed, check that the suite was the size you assumed. `Tests: N passed` is
  the number to read, not the word `passed`.
- **Isolating a test run can silently weaken it.** The pre-push hook now checks the pushed commit
  out into a throwaway worktree, and the first version of that change dropped all 759 without a
  word -- a stricter-looking gate that tested less. Local-only *inputs* (`node_modules`, `.cache`,
  `npc-exports`) are environment rather than content and are linked in deliberately; see
  `scripts/hooks/run-prepush.mjs`. If you add a suite that reads an untracked fixture directory,
  add it to `LOCAL_INPUTS` or the push gate quietly stops running it.

**And `LOCAL_INPUTS` only covers all-or-nothing.** A corpus that is *present but
incomplete* degrades silently in exactly the same way, one file at a time, and no
environment fix can see it: the per-character blocks are generated from an `existsSync`
filter, so a missing save produces *no failing test* -- its assertions are never
constructed. Measured on the real-save corpus: hiding a single file dropped the suite from
**954 to 921 tests**, and both runs would have read `passed`.

`CharacterSheetNpcExporter.realsaves.test.js` &rarr; `describe("v37 -- the corpus is present
in full, or not at all")` closes that: `expect(available).toEqual(SAVE_NAMES)`, skipped
only when the corpus is wholly absent. All-or-nothing is legitimate -- a fresh clone has
none. Partial never is; it means a save was renamed, deleted or failed to copy.

The general rule for any data-driven suite: **if the size of the table is read from the
environment, assert the size.** A count that is discovered rather than declared can shrink
to any value above zero without a single assertion failing.

The general form is the one this guide keeps arriving at from different directions: **a filtered
walk has to assert what it found *and* that it looked.** Here the walk is over files on disk, and
the thing that looked is the environment itself.

## Test File Conventions

- **File naming**: `CharacterSheet{Topic}.test.js` (PascalCase descriptive name)
- **Describe blocks**: Organized by feature/subclass
- **Test descriptions**: "should {action} at level {N}" or "should {result} when {condition}"
- **One assertion focus**: Each test checks one specific behavior (multiple expects are fine if same behavior)
