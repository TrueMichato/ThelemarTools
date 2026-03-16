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
| Mutating state without isolation | Tests leak between each other | Use `beforeEach` for fresh state || Reading `_data.abilities.str` directly | Gets base only, not total | Use `getAbilityScore()` (base+bonus) |
| Not matching source in spell assertions | Blade Ward behaves differently by edition | Always check name AND source |
## Test File Conventions

- **File naming**: `CharacterSheet{Topic}.test.js` (PascalCase descriptive name)
- **Describe blocks**: Organized by feature/subclass
- **Test descriptions**: "should {action} at level {N}" or "should {result} when {condition}"
- **One assertion focus**: Each test checks one specific behavior (multiple expects are fine if same behavior)
