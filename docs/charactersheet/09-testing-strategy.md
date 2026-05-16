# Testing Strategy

This document details the testing approach, patterns, and coverage for the character sheet system.

## Overview

The character sheet has a comprehensive test suite with **~3,200 tests** across **29 test files**. Tests are written using Jest and follow consistent patterns for reliability and maintainability.

---

## Test Organization

### Directory Structure

```
test/jest/charactersheet/
├── CharacterSheetState.test.js           # Core state management
├── CharacterSheetParsers.test.js         # Parser utilities
├── CharacterSheetCombat.test.js          # Combat mechanics
├── CharacterSheetSpells.test.js          # Spellcasting
├── CharacterSheetInventory.test.js       # Inventory
├── CharacterSheetLevelUp.test.js         # Level progression
├── CharacterSheetRest.test.js            # Rest mechanics
├── CharacterSheetIntegration.test.js     # End-to-end flows
├── CharacterSheetToggleAbilities.test.js # Toggle abilities
├── CharacterSheetClasses*.test.js        # Class-specific tests
├── CharacterSheetSubclasses*.test.js     # Subclass-specific tests
├── CharacterSheetMulticlass.test.js      # Multiclass scenarios
├── setup.js                              # Test setup/mocks
└── README.md                             # Test documentation
```

### Test Categories

| Category | Purpose | Example Files |
|----------|---------|---------------|
| **Unit Tests** | Individual functions/methods | `CharacterSheetParsers.test.js` |
| **State Tests** | State management | `CharacterSheetState.test.js` |
| **Feature Tests** | Specific features | `CharacterSheetCombat.test.js` |
| **Integration Tests** | End-to-end workflows | `CharacterSheetIntegration.test.js` |
| **Class Tests** | Class-specific features | `CharacterSheetBarbarian.test.js` |

---

## Running Tests

### Commands

```bash
# Run all character sheet tests
NODE_OPTIONS='--experimental-vm-modules' npx jest test/jest/charactersheet/ --no-coverage

# Run specific test file
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetState --no-coverage

# Run with verbose output
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetState --no-coverage --verbose

# Run tests matching pattern
NODE_OPTIONS='--experimental-vm-modules' npx jest -t "Rage" --no-coverage

# Run with coverage
NODE_OPTIONS='--experimental-vm-modules' npx jest test/jest/charactersheet/ --coverage
```

### VS Code Tasks

The workspace includes pre-configured tasks:

- **Test Toggle Abilities**: Runs toggle ability tests
- **Full CharSheet Tests**: Runs all character sheet tests
- **Full CharSheet Summary**: Shows pass/fail summary

---

## Test Setup

### Global Setup (`setup.js`)

```javascript
// Mock browser APIs
global.window = {
    localStorage: {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
    },
};

global.document = {
    createElement: jest.fn(() => ({
        appendChild: jest.fn(),
        addEventListener: jest.fn(),
    })),
};

// Mock 5etools utilities
global.Parser = {
    ABIL_ABVS: ["str", "dex", "con", "int", "wis", "cha"],
    attAbvToFull: (abv) => ({
        str: "Strength",
        dex: "Dexterity",
        // ...
    })[abv],
    numberToSuperscript: (n) => ["", "st", "nd", "rd"][n] || "th",
    // ...
};

global.JqueryUtil = {
    doToast: jest.fn(),
};

global.Renderer = {
    dice: {
        randomNumber: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
    },
    spell: {
        getCombinedClasses: jest.fn(() => []),
    },
};
```

### Test File Imports

```javascript
// Import the source module
import "../../../js/charactersheet/charactersheet-state.js";

// Get the class from global scope
const CharacterSheetState = globalThis.CharacterSheetState;
```

---

## Test Patterns

### Standard Test Structure

```javascript
describe("Feature Name", () => {
    let state;

    beforeEach(() => {
        // Fresh state for each test
        state = new CharacterSheetState();
    });

    afterEach(() => {
        // Cleanup if needed
    });

    describe("Sub-feature", () => {
        it("should do expected behavior", () => {
            // Arrange - set up preconditions
            state.addClass({name: "Fighter", level: 5, source: "PHB"});
            
            // Act - perform the action
            const result = state.getFeatureCalculations();
            
            // Assert - verify outcomes
            expect(result.hasExtraAttack).toBe(true);
            expect(result.actionSurgeUses).toBe(1);
        });
    });
});
```

### Helper Functions

```javascript
// Common character creation helpers
function createBarbarian(level, source = "PHB") {
    const state = new CharacterSheetState();
    state.addClass({name: "Barbarian", level, source});
    state.setAbilityBase("str", 16);
    state.setAbilityBase("con", 14);
    return state;
}

function createWizard(level, subclass = null) {
    const state = new CharacterSheetState();
    const classObj = {name: "Wizard", level, source: "PHB"};
    if (subclass) {
        classObj.subclass = {name: subclass, shortName: subclass, source: "PHB"};
    }
    state.addClass(classObj);
    state.setAbilityBase("int", 18);
    return state;
}

function createMulticlass(classes) {
    const state = new CharacterSheetState();
    classes.forEach(cls => state.addClass(cls));
    return state;
}
```

### Testing Computed Values

```javascript
describe("Proficiency Bonus", () => {
    it.each([
        [1, 2], [4, 2],
        [5, 3], [8, 3],
        [9, 4], [12, 4],
        [13, 5], [16, 5],
        [17, 6], [20, 6],
    ])("level %i should have proficiency bonus +%i", (level, expected) => {
        state.addClass({name: "Fighter", level, source: "PHB"});
        expect(state.getProficiencyBonus()).toBe(expected);
    });
});
```

### Testing Effects

```javascript
describe("Rage Effects", () => {
    beforeEach(() => {
        state = createBarbarian(5);
    });

    it("should provide damage resistance while raging", () => {
        state.addActiveState("rage");
        
        const effects = state.getActiveStateEffects();
        const resistances = effects.filter(e => e.type === "resistance");
        
        expect(resistances).toContainEqual(
            expect.objectContaining({target: "damage:bludgeoning"})
        );
        expect(resistances).toContainEqual(
            expect.objectContaining({target: "damage:piercing"})
        );
        expect(resistances).toContainEqual(
            expect.objectContaining({target: "damage:slashing"})
        );
    });
});
```

---

## Coverage Areas

### Core State Management

- ✅ Ability scores (base, bonuses, modifiers)
- ✅ Hit points (current, max, temp)
- ✅ Hit dice (tracking, spending, recovery)
- ✅ Proficiency bonus calculation
- ✅ AC calculation (all armor types)
- ✅ Saving throw modifiers
- ✅ Skill modifiers (proficiency, expertise)
- ✅ Speed calculations
- ✅ Passive scores
- ✅ Death saves
- ✅ Serialization/deserialization

### Class Features

- ✅ `getFeatureCalculations()` for all 13 classes
- ✅ All official subclasses
- ✅ 2014 vs 2024 rule differences
- ✅ Feature scaling by level
- ✅ Resource tracking (Ki, Rage, Sorcery Points)

### Combat

- ✅ Attack bonus calculation
- ✅ Damage bonus calculation
- ✅ Critical hit detection
- ✅ Initiative modifiers
- ✅ Condition effects
- ✅ Exhaustion levels

### Spellcasting

- ✅ Spell slot progression
- ✅ Pact magic
- ✅ Spell save DC
- ✅ Spell attack bonus
- ✅ Multiclass slot calculation
- ✅ Concentration tracking

### Toggle Abilities

- ✅ State type definitions
- ✅ Effect application
- ✅ Resource consumption
- ✅ Detection from feature text
- ✅ Class-specific toggles (Rage, Bladesong)
- ✅ Homebrew toggle support

---

## Test Naming Conventions

### Describe Blocks

```javascript
// Top-level: Feature area
describe("CharacterSheetState", () => {
    // Mid-level: Specific feature
    describe("Ability Scores", () => {
        // Low-level: Specific aspect
        describe("getAbilityMod", () => {
            // Tests
        });
    });
});
```

### Test Names

Follow the pattern: "should [expected behavior] when [condition]"

```javascript
it("should return +3 modifier for score of 16", () => {...});
it("should throw error when ability is invalid", () => {...});
it("should apply racial bonus to final score", () => {...});
```

---

## Mocking Strategies

### Mocking Random Numbers

```javascript
describe("Attack Rolls", () => {
    beforeEach(() => {
        // Mock dice to return predictable values
        jest.spyOn(Renderer.dice, "randomNumber")
            .mockImplementation(() => 15);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("should calculate attack total correctly", () => {
        const result = state.rollAttack({attackBonus: 5});
        expect(result.total).toBe(20); // 15 + 5
    });
});
```

### Mocking Time

```javascript
describe("Concentration Duration", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("should track concentration duration", () => {
        state.setConcentration({spellName: "Bless", durationMinutes: 10});
        
        jest.advanceTimersByTime(5 * 60 * 1000); // 5 minutes
        
        expect(state.isConcentrationActive()).toBe(true);
        
        jest.advanceTimersByTime(6 * 60 * 1000); // 6 more minutes
        
        expect(state.isConcentrationActive()).toBe(false);
    });
});
```

---

## Debugging Failed Tests

### Getting Detailed Output

```bash
# Show which tests are running
npx jest CharacterSheetState --verbose

# Show only failures
npx jest CharacterSheetState 2>&1 | grep -B5 "Expected\|Received"

# Run single test
npx jest -t "should calculate proficiency bonus"
```

### Common Issues

1. **State pollution between tests**: Ensure `beforeEach` creates fresh state
2. **Missing mocks**: Check `setup.js` for required global mocks
3. **Import errors**: Verify ES module syntax and paths
4. **Async issues**: Use `async/await` for async tests

---

## Adding New Tests

### When to Add Tests

1. New feature implementation
2. Bug fix (add regression test)
3. Edge case discovered
4. Refactoring (ensure behavior preserved)

### Test Checklist

- [ ] Test file in correct location
- [ ] Imports setup correctly
- [ ] `beforeEach` creates fresh state
- [ ] Tests are isolated (no shared state)
- [ ] Test names are descriptive
- [ ] All assertions have meaningful messages
- [ ] Edge cases covered
- [ ] Both success and failure paths tested

### Example: Adding Class Tests

```javascript
// CharacterSheetNewClass.test.js
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("New Class Features", () => {
    describe("Level 1 Features", () => {
        it("should have core feature at level 1", () => {
            const state = new CharacterSheetState();
            state.addClass({name: "NewClass", level: 1, source: "SRC"});
            
            const calc = state.getFeatureCalculations();
            
            expect(calc.hasCoreFeature).toBe(true);
        });
    });

    describe("Scaling Features", () => {
        it.each([
            [1, "1d6"],
            [5, "1d8"],
            [11, "1d10"],
            [17, "1d12"],
        ])("level %i should have damage die %s", (level, expectedDie) => {
            const state = new CharacterSheetState();
            state.addClass({name: "NewClass", level, source: "SRC"});
            
            const calc = state.getFeatureCalculations();
            
            expect(calc.damageDie).toBe(expectedDie);
        });
    });
});
```

---

## Continuous Integration

Tests run automatically on:
- Pull request creation
- Push to main branch
- Scheduled nightly builds

### CI Configuration

```yaml
# .github/workflows/test.yml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
      with:
        node-version: '18'
    - run: npm ci
    - run: npm run test:unit -- --coverage
    - uses: codecov/codecov-action@v3
```

---

## Modifier System Tests

`test/jest/charactersheet/CharacterSheetConditionalModifiers.test.js` covers the unified conditional-modifier pipeline:

- `_isConditionalSaveSubtype` positive/negative classification
- `_buildConditionalModId` determinism and adv-/dis- stripping
- `aggregateModifiers` gates conditional entries by default
- Both encodings (text-parsed `{conditional: "…"}` and registry sub-typed `save:advantage:<sub>`) appear identically in `conditionalsAvailable`
- Opt-in via `appliedConditionalIds` folds the right entries into `bonus` / `advantage` / `disadvantage`
- `getAdvantageState` and `getModifierBonus` forward opts unchanged

When modifying any of `_parseModifierType`, `getModifiersForType`, `aggregateModifiers`, or the two static helpers in `charactersheet-state.js`, run this suite first.

---

*Previous: [Toggle Abilities](./08-toggle-abilities.md) | Next: [Known Limitations](./10-known-limitations.md)*
