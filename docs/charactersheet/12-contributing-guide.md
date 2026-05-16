# Contributing Guide

This document provides guidance for developers who want to contribute to the character sheet system.

---

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm 9+
- Git
- Code editor (VS Code recommended)

### Setup

```bash
# Clone the repository
git clone https://github.com/5etools-mirror-1/5etools-src.git
cd 5etools-src

# Install dependencies
npm install

# Run tests to verify setup
NODE_OPTIONS='--experimental-vm-modules' npx jest test/jest/charactersheet/ --no-coverage
```

### Project Structure

```
5etools-src/
├── js/charactersheet/           # Source code
│   ├── charactersheet.js        # Main controller
│   ├── charactersheet-state.js  # State management
│   ├── charactersheet-combat.js # Combat mechanics
│   ├── charactersheet-spells.js # Spellcasting
│   └── ...                      # Other modules
├── test/jest/charactersheet/    # Test files
│   ├── setup.js                 # Test setup
│   ├── CharacterSheetState.test.js
│   └── ...                      # Test files
├── docs/charactersheet/         # Documentation
└── charactersheet.html          # Entry point
```

---

## Development Workflow

### 1. Choose What to Work On

Good first issues:
- Add missing subclass calculations
- Convert weak test patterns
- Add JSDoc comments
- Fix typos/documentation

Check [Known Limitations](./10-known-limitations.md) for larger items.

### 2. Create a Branch

```bash
# Update main
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/add-alchemist-calculations
```

Branch naming:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation
- `test/` - Test improvements
- `refactor/` - Code refactoring

### 3. Make Changes

Follow the coding standards (see below).

### 4. Write/Update Tests

Every feature needs tests. See [Testing Strategy](./09-testing-strategy.md).

### 5. Run Tests

```bash
# Run all character sheet tests
NODE_OPTIONS='--experimental-vm-modules' npx jest test/jest/charactersheet/ --no-coverage

# Run specific test file
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetState --no-coverage
```

### 6. Submit PR

```bash
# Commit changes
git add .
git commit -m "feat(charsheet): add Alchemist subclass calculations"

# Push branch
git push origin feature/add-alchemist-calculations
```

Open PR on GitHub with:
- Clear title
- Description of changes
- Link to related issue
- Test results

---

## Coding Standards

### JavaScript Style

```javascript
// Use tabs for indentation
class CharacterSheetState {
	constructor () {
		this._data = {};
	}

	// Methods use camelCase
	getAbilityMod (ability) {
		const score = this.getAbilityScore(ability);
		return Math.floor((score - 10) / 2);
	}

	// Private methods start with underscore
	_calculateAc () {
		// Implementation
	}

	// Static methods are allowed
	static parseFeatureUses (text) {
		// Implementation
	}
}
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `CharacterSheetState` |
| Methods | camelCase | `getAbilityMod` |
| Private | _camelCase | `_calculateAc` |
| Constants | UPPER_SNAKE | `ACTIVE_STATE_TYPES` |
| Parameters | camelCase | `abilityScore` |

### JSDoc Comments

```javascript
/**
 * Calculate the modifier for an ability score.
 * 
 * @param {string} ability - The ability abbreviation (str, dex, con, int, wis, cha)
 * @returns {number} The ability modifier
 * @throws {Error} If ability is not valid
 * 
 * @example
 * const mod = state.getAbilityMod("str");
 * // Returns 3 if STR score is 16
 */
getAbilityMod (ability) {
	// Implementation
}
```

---

## Implementation Patterns

### Adding Class Features

Location: `charactersheet-state.js` in `getFeatureCalculations()`

```javascript
case "NewClass": {
    const source = cls.source || "PHB";
    const is2024 = source === "XPHB";
    
    // Level 1 features
    calculations.hasCoreFeature = true;
    
    // Scaling features
    const featureDie = level >= 17 ? "1d12" : level >= 11 ? "1d10" : 
        level >= 5 ? "1d8" : "1d6";
    calculations.featureDie = featureDie;
    
    // Resource that scales
    calculations.resourcePoints = level;
    calculations.resourceDc = 8 + profBonus + this.getAbilityMod("wis");
    
    // Level-gated features
    if (level >= 5) {
        calculations.hasExtraAttack = true;
    }
    
    // Edition differences
    if (is2024) {
        calculations.newFeature2024 = true;
    }
    
    // Subclass features
    if (cls.subclass?.shortName === "Subclass") {
        if (level >= 3) {
            calculations.hasSubclassFeature = true;
        }
    }
    
    break;
}
```

### Adding Toggle Abilities

Location: `charactersheet-state.js` in `ACTIVE_STATE_TYPES`

```javascript
newToggle: {
    id: "newToggle",
    name: "New Toggle",
    icon: "⭐",
    description: "Description of what this does",
    effects: [
        {type: "bonus", target: "ac", value: 2},
        {type: "advantage", target: "check:str"},
        {type: "resistance", target: "damage:fire"},
    ],
    duration: "1 minute",
    endConditions: ["Condition 1", "Condition 2"],
    resourceName: "Resource",
    resourceCost: 1,
    detectPatterns: ["pattern1", "pattern2"],
    activationAction: "bonus",
},
```

### Adding Parsers

Location: Create new class or extend existing parser

```javascript
/**
 * Parser for [specific content type]
 */
class NewContentParser {
    /**
     * Parse [content] from text
     * @param {string} text - The text to parse
     * @returns {Object|null} Parsed result or null
     */
    static parse (text) {
        if (!text) return null;
        
        // Strip HTML
        const plainText = text.replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .toLowerCase();
        
        // Pattern matching
        const match = plainText.match(/pattern/i);
        if (!match) return null;
        
        return {
            property: match[1],
            // ... more properties
        };
    }
}

// Make available globally
globalThis.NewContentParser = NewContentParser;
```

---

## Writing Tests

### Test File Structure

```javascript
/**
 * Tests for [Feature Name]
 */
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// Helper functions
function createTestCharacter(options = {}) {
    const state = new CharacterSheetState();
    // Setup based on options
    return state;
}

describe("Feature Name", () => {
    let state;

    beforeEach(() => {
        state = new CharacterSheetState();
    });

    describe("Core functionality", () => {
        it("should handle basic case", () => {
            // Arrange
            state.addClass({name: "Fighter", level: 5, source: "PHB"});
            
            // Act
            const result = state.getFeatureCalculations();
            
            // Assert
            expect(result.hasExtraAttack).toBe(true);
        });
    });

    describe("Edge cases", () => {
        it("should handle empty input", () => {
            expect(() => state.doSomething(null)).not.toThrow();
        });
    });
});
```

### Test Patterns

#### Testing Scaling Values

```javascript
describe("Feature scaling", () => {
    it.each([
        [1, "1d6"],
        [5, "1d8"],
        [11, "1d10"],
        [17, "1d12"],
    ])("level %i should have die %s", (level, expected) => {
        state.addClass({name: "Class", level, source: "PHB"});
        const calc = state.getFeatureCalculations();
        expect(calc.featureDie).toBe(expected);
    });
});
```

#### Testing Computed Values

```javascript
describe("Computed values", () => {
    it("should calculate DC correctly", () => {
        state.addClass({name: "Monk", level: 5, source: "PHB"});
        state.setAbilityBase("wis", 16); // +3 mod
        
        const calc = state.getFeatureCalculations();
        
        // DC = 8 + prof(3) + wis(3) = 14
        expect(calc.kiSaveDc).toBe(14);
    });
});
```

#### Testing Effects

```javascript
describe("Active state effects", () => {
    it("should apply all rage effects", () => {
        state.addClass({name: "Barbarian", level: 5, source: "PHB"});
        state.addActiveState("rage");
        
        const effects = state.getActiveStateEffects();
        
        expect(effects).toContainEqual(
            expect.objectContaining({
                type: "resistance",
                target: "damage:bludgeoning"
            })
        );
        expect(effects).toContainEqual(
            expect.objectContaining({
                type: "advantage",
                target: "check:str"
            })
        );
    });
});
```

---

## Review Process

### Before Submitting

- [ ] All tests pass
- [ ] New features have tests
- [ ] Code follows style guide
- [ ] JSDoc comments added
- [ ] No console.log statements
- [ ] Branch is up to date with main

### Review Criteria

| Area | Expectation |
|------|-------------|
| **Correctness** | Feature works as intended |
| **Tests** | Adequate coverage, correct assertions |
| **Code quality** | Follows patterns, readable |
| **Documentation** | JSDoc, comments where needed |
| **Performance** | No obvious inefficiencies |

### Addressing Feedback

- Respond to all comments
- Push fixes as new commits (don't force push)
- Re-request review when ready

---

## Getting Help

### Resources

- [Architecture Overview](./02-architecture.md)
- [State Management](./04-state-management.md)
- [Testing Strategy](./09-testing-strategy.md)

### Questions

- Open a GitHub Discussion
- Comment on related issue
- Check existing documentation

---

## Recognition

Contributors are recognized in:
- Git commit history
- Release notes
- CONTRIBUTORS.md

Thank you for helping improve the character sheet!

---

## Doc-Sync Checklist for Closed Bugs / New Subsystems (advisory)

When closing a bug in `bugs.md` that adds **new public state methods, new modules, new UI surfaces, or new user-facing settings**, the closure entry should reference (or land alongside) doc updates in:

1. The relevant `docs/charactersheet/0X-*.md` reference doc — add a section that names the new symbols and explains their role
2. `.agents/skills/charactersheet-development/references/subsystem-details.md` — concise sub-section (function name + 2–3 line description + file/line ref) so agents loading the skill on demand have current info
3. `AGENTS.md` (workspace root) — update the module map row if a new module landed; add a Critical Facts bullet if a new invariant or default behaviour was introduced
4. `CHARACTERSHEET_TEST_AUDIT.md` — add a row to **Recently Added Suites** if a new test file was created

This is advisory, not enforced — but a bug closure narrative without these touches is treated as incomplete during review. The cost of one extra paragraph at close-time is far less than the drift that builds up otherwise (witness the four-feature backlog this checklist was added to address: favorites, Apply Buff modal, lore skills, conditional modifiers).

---

*Previous: [Future Roadmap](./11-future-roadmap.md) | [Back to Index](./README.md)*
