# System Architecture

## High-Level Architecture

The Character Sheet system follows a **Model-View-Controller (MVC)** pattern with event-driven communication between modules.

```
┌─────────────────────────────────────────────────────────────────────┐
│                           charactersheet.html                         │
│                              (Entry Point)                            │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      CharacterSheetPage (Controller)                  │
│                         charactersheet.js                             │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ • Orchestrates all modules                                       ││
│  │ • Loads 5etools data (races, classes, spells, items)            ││
│  │ • Manages character save/load                                    ││
│  │ • Routes events between modules                                  ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
           │
           ├──────────────┬──────────────┬──────────────┬─────────────┐
           ▼              ▼              ▼              ▼             ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐
│    State     │ │   Builder    │ │   Combat     │ │   Spells     │ │  Features  │
│ (Model)      │ │ (Wizard)     │ │ (Actions)    │ │ (Casting)    │ │  (Display) │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘
           │              │              │              │             │
           ├──────────────┴──────────────┴──────────────┴─────────────┘
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     CharacterSheetState (Model)                       │
│                      charactersheet-state.js                          │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ • Stores all character data                                      ││
│  │ • Computes derived values (modifiers, AC, spell DC, etc.)       ││
│  │ • Provides serialization (toJson/loadFromJson)                  ││
│  │ • Class-specific calculations (getFeatureCalculations)          ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

## Module Dependency Graph

```
                    CharacterSheetPage
                          │
    ┌─────────┬───────────┼───────────┬─────────┬─────────┐
    │         │           │           │         │         │
    ▼         ▼           ▼           ▼         ▼         ▼
 Builder   Combat      Spells    Inventory  Features    Rest
    │         │           │           │         │         │
    │         ▼           ▼           ▼         ▼         │
    │    ┌────────────────────────────────────────┐       │
    │    │                                        │       │
    └───▶│        CharacterSheetState             │◀──────┘
         │                                        │
         │  • _data (raw character data)          │
         │  • getters/setters for all fields      │
         │  • computed values (modifiers, etc.)   │
         │  • getFeatureCalculations()            │
         │  • Active States (Rage, etc.)          │
         │  • Conditions & Effects                │
         │                                        │
         └────────────────────────────────────────┘
              │
              ▼
         ┌────────────────────┐
         │   Parser Helpers   │
         │                    │
         │ • FeatureUsesParser│
         │ • NaturalWeaponParser│
         │ • SpellGrantParser │
         │ • FeatureModifierParser│
         └────────────────────┘
```

## Data Flow

### 1. Initialization Flow

```
1. charactersheet.html loads
2. CharacterSheetPage.pInit() called
3. Load 5etools data files (races, classes, spells, items, feats)
4. Initialize UI elements
5. Initialize sub-modules (builder, combat, spells, etc.)
6. Load saved characters from localStorage
7. If character selected, load into state
8. Render all UI sections
```

### 2. User Action Flow

```
User Action (e.g., "Add Class")
        │
        ▼
┌──────────────────┐
│ Event Handler    │  (in appropriate module)
│ e.g., _onAddClass│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ State Mutation   │  this._state.addClass(...)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Recalculation    │  Derived values updated automatically
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ UI Re-render     │  this._page.renderAll() or specific render
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Auto-save        │  this._page.saveCharacter()
└──────────────────┘
```

### 3. Calculation Flow

When a derived value is needed (e.g., spell save DC):

```
getSpellSaveDc(className)
        │
        ├─── Get proficiency bonus (getProficiencyBonus)
        │           │
        │           └─── Calculate from total level
        │
        ├─── Get spellcasting ability for class
        │           │
        │           └─── Look up in class data
        │
        ├─── Get ability modifier (getAbilityMod)
        │           │
        │           ├─── Base score
        │           ├─── + Racial bonuses
        │           ├─── + ASI bonuses
        │           ├─── + Item bonuses
        │           └─── Calculate modifier
        │
        ├─── Get custom modifiers
        │
        └─── Return 8 + proficiency + ability mod + custom
```

## Module Responsibilities

### CharacterSheetPage (`charactersheet.js`)

**Role**: Main controller / orchestrator

**Responsibilities**:
- Initialize all sub-modules
- Load and cache 5etools data
- Manage character persistence (localStorage)
- Route events between modules
- Coordinate UI rendering

**Key Methods**:
```javascript
pInit()              // Initialize everything
_pLoadData()         // Load 5etools JSON files
saveCharacter()      // Persist to localStorage
renderAll()          // Update entire UI
getState()           // Return CharacterSheetState instance
```

### CharacterSheetState (`charactersheet-state.js`)

**Role**: Data model / calculation engine

**Responsibilities**:
- Store all character data
- Compute derived values (modifiers, AC, DC, etc.)
- Class/race/subclass feature calculations
- Active state management (Rage, conditions)
- Serialization/deserialization

**Key Methods**:
```javascript
// Basic info
getName(), setName()
getRace(), setRace()
getClasses(), addClass(), removeClass()

// Ability scores
getAbilityScore(), getAbilityMod()
setAbilityBase(), setAbilityRacialBonus()

// Computed values
getAc()
getProficiencyBonus()
getSpellSaveDc()
getFeatureCalculations()  // Class-specific mechanics

// Active states
addActiveState(), removeActiveState()
isStateTypeActive()

// Serialization
toJson(), loadFromJson()
```

### CharacterSheetBuilder (`charactersheet-builder.js`)

**Role**: Character creation wizard

**Responsibilities**:
- Step-by-step character creation UI
- Race/class/background selection
- Ability score assignment (standard array, point buy, manual)
- Skill/tool/language proficiency selection
- Apply choices to state

**Steps**:
1. Race selection
2. Class selection
3. Ability scores
4. Background selection
5. Skills & proficiencies
6. Review & create

### CharacterSheetCombat (`charactersheet-combat.js`)

**Role**: Combat actions and tracking

**Responsibilities**:
- Attack creation and management
- Attack/damage rolling
- Initiative rolling
- Death save tracking
- Condition management
- Combat spell casting
- Stamina point tracking (for TGTT)

### CharacterSheetSpells (`charactersheet-spells.js`)

**Role**: Spellcasting management

**Responsibilities**:
- Spell slot tracking
- Known/prepared spells
- Spell casting (with slot consumption)
- Pact magic (Warlock)
- Ritual casting
- Concentration tracking

### CharacterSheetInventory (`charactersheet-inventory.js`)

**Role**: Item and equipment management

**Responsibilities**:
- Item storage and display
- Equipment (equip/unequip)
- Attunement management
- Currency tracking
- Encumbrance calculation
- Item charges

### CharacterSheetFeatures (`charactersheet-features.js`)

**Role**: Feature display and tracking

**Responsibilities**:
- Display class/race features
- Feat management
- Feature use tracking
- Optional feature choices
- Feature description lookup

### CharacterSheetRest (`charactersheet-rest.js`)

**Role**: Rest mechanics

**Responsibilities**:
- Short rest (hit dice spending)
- Long rest (full recovery)
- Feature use recovery
- Spell slot recovery

### CharacterSheetLevelUp (`charactersheet-levelup.js`)

**Role**: Level progression

**Responsibilities**:
- Level up workflow
- New feature acquisition
- Ability Score Improvements
- Subclass selection (at appropriate levels)
- Multiclassing

### CharacterSheetExport (`charactersheet-export.js`)

**Role**: Data import/export

**Responsibilities**:
- JSON export
- JSON import
- Print/PDF generation

### CharacterSheetLayout (`charactersheet-layout.js`)

**Role**: UI customization

**Responsibilities**:
- Section reordering via drag-and-drop
- Layout persistence per character
- Edit mode toggle

## Event Communication

Modules communicate through:

1. **Direct Method Calls**: `this._page.saveCharacter()`
2. **State Updates**: `this._state.setHp(...)` triggers recalculation
3. **jQuery Events**: DOM event handlers for user interactions
4. **Render Callbacks**: `this._page.renderAll()` or specific `render*()` methods

## Persistence Layer

```
localStorage
    │
    ├── "5etools-charsheet-characters"
    │       │
    │       └── JSON array of character objects
    │               │
    │               ├── id: unique identifier
    │               ├── name: character name
    │               ├── data: full character state (from toJson())
    │               └── lastModified: timestamp
    │
    └── "5etools-charsheet-current"
            │
            └── ID of currently selected character
```

---

*Previous: [Overview & Goals](./01-overview-and-goals.md) | Next: [Components Reference](./03-components-reference.md)*
