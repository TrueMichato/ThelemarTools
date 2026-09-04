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

### Campaign Hub semantic-operation boundary

Campaign Hub protocol v3 keeps the canonical online document server-authoritative while preserving local mode.
Without `hubCampaign`, the Character Sheet uses its existing local repository and no semantic-operation network
contract is active.

For Hub characters, the server emits only the ADR 0012 lifecycle allowlist:
`character.operation.proposed`, `.applied`, `.rejected`, `.cancelled`, and `.expired`. An applied payload carries
the normalized version-1 operation and resulting canonical revision; actor identity remains in the authorized
event envelope. Owner/DM truth carries `operationWatermark`, while peers never receive that hidden sequence.

The server/store slice persists and delivers this contract, but this document does not claim that the current
sheet has implemented the later operation-aware `B/L -> R/F` live-edit reconciliation, conflict-modal
coordination, banners, or peer approval UI. Until that client slice lands, ordinary local behavior and existing
Hub repository save/rebase behavior remain unchanged.

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

### CharacterSheetPeerTargeting (`charactersheet-peer-targeting.js`)

**Role**: Campaign-only sender coordination for accepted peer spell/effect templates

**Responsibilities**:
- Fail closed unless the campaign advertises the exact protocol-4 source-cost capability
- Discover targets through authorization-scoped projections and submit only opaque `targetRef`
- Keep proposal/cancel command identities stable across retries
- Render source-owner pending and terminal status without target truth or source resource internals
- Refetch on reconnect/focus and fence stale responses on character switches

The spell module calls this coordinator after slot and casting-option selection but before any local resource
mutation. A handled campaign proposal returns immediately; ordinary, unsupported, local, and signed-out casts
continue through the pre-existing local flow.

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
- Print/PDF generation via `CharacterSheetPdf` (print-optimized HTML → browser Save as PDF)

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
5. **Campaign Realtime Callbacks**: `CharacterSheetRealtimeCoordinator.on()` delivers connection/cursor
   metadata, projection invalidations, and semantic-operation lifecycle events for the open canonical campaign
   character.

The campaign realtime coordinator starts only after authenticated campaign activation and canonical character
load. It routes the exact `character.operation.*` allowlist through the HTTP repository's save queue and fences
callbacks on switch, detach, access loss, logout, and terminal page hide. A missing canonical cursor ref or a
matching remote archive/move event queues teardown behind already-accepted operation delivery. A persisted
`pagehide` suspends the socket; persisted `pageshow` resumes the same client with its sequence/deduplication
state intact. Applied semantic operations are reconciled live by the ADR 0012 `B/L -> R/F` layer: the accepted base becomes
`R = E(B)`, live state becomes `F = E(L)`, and the next save is naturally `diff(R, F)`, so a DM effect and an
unsaved player edit both survive. The operation is applied by the shared pure applicator
(`js/hub/hub-semantic-operations.js`), never by sheet mutators such as `addCondition()` or `takeDamage()`, whose
immunity checks, Thelemar variant remapping, `bloodied` toggling and concentration side effects would make
`F != E(L)` and cause the follow-up patch to fight canonical state. Adoption reuses the existing
`loadFromJson` -> `_reconcileClassFeatures()` -> `_renderCharacter()` path; rendering runs after the transaction
commits so a paint failure cannot roll back coherent state. Client-derived state such as `bloodied` is re-derived
on the live track only and travels to the server as an ordinary owner patch.

## Persistence Layer

Campaign-backed sheets use `HubHttpCharacterRepository`; local sheets retain the local repository below.
Realtime lifecycle payloads are memory-only callback values and never enter either persistence backend,
recovery storage, logs, or caches.

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
