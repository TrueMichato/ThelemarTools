# Toggle Abilities System

This document details the toggle abilities (active states) system that manages activatable features like Rage, Bladesong, and combat stances.

## Overview

Toggle abilities are features that can be activated and deactivated, providing temporary effects while active. The system handles:

- Standard D&D abilities (Rage, Wild Shape, Patient Defense)
- Wizard features (Bladesong)
- Combat stances (from various homebrew sources)
- Custom/homebrew toggle abilities
- Automatic detection and categorization

---

## Architecture

### ACTIVE_STATE_TYPES

The core definition of all supported toggle ability types lives in `CharacterSheetState`:

```javascript
static ACTIVE_STATE_TYPES = {
    rage: {
        id: "rage",
        name: "Rage",
        icon: "💢",
        description: "Advantage on Strength checks/saves, resistance to B/P/S damage, +rage damage bonus",
        effects: [
            {type: "advantage", target: "check:str"},
            {type: "advantage", target: "save:str"},
            {type: "resistance", target: "damage:bludgeoning"},
            {type: "resistance", target: "damage:piercing"},
            {type: "resistance", target: "damage:slashing"},
            {type: "rageDamage", target: "melee:str"},
        ],
        duration: "1 minute",
        endConditions: ["No attack or damage taken for 1 turn", "Knocked unconscious", "Ended as bonus action"],
        resourceName: "Rage",
        resourceCost: 1,
        detectPatterns: ["^rage$", "enter.*rage", "you can.*rage"],
        activationAction: "bonus",
    },
    // ... more state types
};
```

### State Type Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Display name |
| `icon` | string | Emoji icon |
| `description` | string | Brief description |
| `effects` | array | Mechanical effects while active |
| `duration` | string | How long it lasts |
| `endConditions` | array | Ways the state can end |
| `resourceName` | string | Resource consumed (e.g., "Rage", "Ki Points") |
| `resourceCost` | number | Cost per activation |
| `detectPatterns` | array | Regex patterns for auto-detection |
| `activationAction` | string | Action type: "bonus", "action", "free", "reaction" |
| `requiresClass` | string | Class requirement (optional) |
| `requiresClassLevel` | number | Minimum level (optional) |
| `isGeneric` | boolean | If true, effects parsed from feature |
| `useFeatureDescription` | boolean | Show feature description instead of generic |

---

## Effect Types

### Advantage/Disadvantage

```javascript
{type: "advantage", target: "check:str"}        // Advantage on STR checks
{type: "advantage", target: "save:dex"}         // Advantage on DEX saves
{type: "advantage", target: "attack:melee:str"} // Advantage on melee STR attacks
{type: "disadvantage", target: "attacksAgainst"} // Attackers have disadvantage
```

### Numeric Bonuses

```javascript
{type: "bonus", target: "ac", value: 2}           // +2 AC
{type: "bonus", target: "ac", abilityMod: "int"}  // +INT to AC
{type: "bonus", target: "speed:walk", value: 10}  // +10 walking speed
{type: "bonus", target: "damage:melee", value: 2} // +2 melee damage
```

### Resistances/Immunities

```javascript
{type: "resistance", target: "damage:bludgeoning"}
{type: "resistance", target: "damage:fire"}
{type: "immunity", target: "condition:frightened"}
```

### Special Effects

```javascript
{type: "rageDamage", target: "melee:str"}     // Uses calculated rage damage
{type: "sizeIncrease", value: 1}              // Count as one size larger
{type: "replaceStats", targets: ["str", "dex"]} // Wild Shape stat replacement
{type: "note", value: "Description text"}     // Informational note
```

---

## Supported Toggle Abilities

### Core D&D Abilities

#### Rage (Barbarian)
```javascript
rage: {
    effects: [
        {type: "advantage", target: "check:str"},
        {type: "advantage", target: "save:str"},
        {type: "resistance", target: "damage:bludgeoning"},
        {type: "resistance", target: "damage:piercing"},
        {type: "resistance", target: "damage:slashing"},
        {type: "rageDamage", target: "melee:str"},
    ],
    duration: "1 minute",
    resourceCost: 1,
    activationAction: "bonus",
}
```

#### Bladesong (Bladesinger Wizard)
```javascript
bladesong: {
    effects: [
        {type: "bonus", target: "ac", abilityMod: "int"},
        {type: "bonus", target: "speed:walk", value: 10},
        {type: "advantage", target: "skill:acrobatics"},
        {type: "bonus", target: "concentration", abilityMod: "int"},
    ],
    duration: "1 minute",
    resourceCost: 1, // Uses per proficiency bonus
    activationAction: "bonus",
}
```

#### Wild Shape (Druid)
```javascript
wildShape: {
    effects: [
        {type: "replaceStats", targets: ["str", "dex", "con"]},
        {type: "replaceHp", target: "tempHp"},
        {type: "replaceAc", target: "naturalArmor"},
    ],
    duration: "Hours based on druid level",
}
```

#### Reckless Attack (Barbarian)
```javascript
recklessAttack: {
    effects: [
        {type: "advantage", target: "attack:melee:str"},
        {type: "advantage", target: "attacksAgainst"},
    ],
    duration: "This turn",
    requiresClass: "barbarian",
    requiresClassLevel: 2,
}
```

#### Patient Defense (Monk)
```javascript
patientDefense: {
    effects: [
        {type: "disadvantage", target: "attacksAgainst"},
        {type: "advantage", target: "save:dex"},
    ],
    duration: "Until start of next turn",
    resourceName: "Ki Points",
    resourceCost: 1,
    activationAction: "bonus",
}
```

### Combat Stances (TGTT/Homebrew)

#### Heavy Stance (Adamant Mountain)
```javascript
heavyStance: {
    effects: [
        {type: "bonus", target: "check:str:athletics", useProficiency: true},
        {type: "bonus", target: "save:resist-movement", useProficiency: true},
        {type: "note", value: "Ignore first 10 ft of difficult terrain each turn"},
    ],
    resourceName: "Stamina",
    resourceCost: 1,
    activationAction: "bonus",
}
```

#### Stand Tall Stance
```javascript
standTallStance: {
    effects: [
        {type: "sizeIncrease", value: 1},
        {type: "note", value: "Creatures smaller than you have disadvantage on saves vs your combat methods"},
    ],
    resourceName: "Stamina",
    resourceCost: 1,
}
```

#### Iron Punisher
```javascript
ironPunisher: {
    effects: [
        {type: "advantage", target: "attack:melee"},
        {type: "advantage", target: "attacksAgainst"},
    ],
    activationAction: "free",
}
```

---

## Detection System

### How Detection Works

When features are loaded, the system analyzes them for toggle capability:

```javascript
static detectActivatableFeature(feature) {
    const name = feature.name?.toLowerCase() || "";
    const text = this._getFeatureText(feature);
    
    // Check each state type's detect patterns
    for (const [stateTypeId, stateType] of Object.entries(this.ACTIVE_STATE_TYPES)) {
        if (!stateType.detectPatterns?.length) continue;
        
        for (const pattern of stateType.detectPatterns) {
            const regex = new RegExp(pattern, "i");
            if (regex.test(name) || regex.test(text)) {
                return {stateTypeId, stateType, matchedPattern: pattern};
            }
        }
    }
    
    // Fallback: analyze text for toggle-like patterns
    return this.analyzeToggleability(text);
}
```

### Toggle Analysis

For features without explicit patterns, the system analyzes the text:

```javascript
static analyzeToggleability(text) {
    const plainText = text.replace(/<[^>]*>/g, " ").toLowerCase();
    
    // Activation phrases
    const activationPatterns = [
        /as a bonus action.*you can/i,
        /you can use.*bonus action to/i,
        /when you.*enter/i,
        /while (this|the) (effect|stance|state) is active/i,
    ];
    
    // Duration phrases
    const durationPatterns = [
        /lasts? (for )?(\d+) (minute|hour|round)/i,
        /until (the (start|end) of your (next )?turn|you (end|dismiss) it)/i,
        /for the duration/i,
    ];
    
    // Check for matches
    const hasActivation = activationPatterns.some(p => p.test(plainText));
    const hasDuration = durationPatterns.some(p => p.test(plainText));
    
    if (hasActivation || hasDuration) {
        return {
            isToggle: true,
            activationType: this._detectActivationType(plainText),
            duration: this._extractDuration(plainText),
        };
    }
    
    return {isToggle: false};
}
```

---

## Active State Management

### State Data Structure

```javascript
// In CharacterSheetState._data
activeStates: [
    {
        id: "rage_1234567890",        // Unique instance ID (typeId + timestamp)
        stateTypeId: "rage",          // Type from ACTIVE_STATE_TYPES
        name: "Rage",                 // Display name
        icon: "💢",                   // Display icon
        description: null,            // Optional feature description
        active: true,                 // Currently active?
        activatedAt: 1234567890,      // Real-world timestamp (Date.now())
        activatedAtRound: 1,          // Combat round when activated (null if outside combat)
        sourceFeatureId: null,        // Link to source feature
        resourceId: null,             // Link to resource spent
        customEffects: [],            // Additional effects from feature
        spellName: null,              // For concentration states
        spellLevel: null,             // For concentration states
        concentration: false,         // Is concentration state?
        isSpellEffect: false,         // From a spell?
        duration: "1 minute",         // Display duration string
        roundsRemaining: 10,          // Rounds left (null = indefinite, decremented by advanceRound)
        grantsConditions: null,       // Conditions granted by this state
        beastData: null,              // For Wild Shape beast form
    },
]
```

### Activating a State

```javascript
activateState(stateTypeId, options = {}) {
    const stateType = CharacterSheetState.ACTIVE_STATE_TYPES[stateTypeId];

    // Enforce mutual exclusivity (e.g., Rage vs Bladesong)
    if (stateType?.exclusiveWith?.length) {
        for (const exclusiveId of stateType.exclusiveWith) {
            this.deactivateState(exclusiveId);
        }
    }

    // States that break concentration (e.g., Rage)
    if (stateType?.breaksConcentration && this._data.concentrating) {
        this.breakConcentration();
    }

    // Reactivate existing or create new
    const existing = this._data.activeStates.find(s => s.stateTypeId === stateTypeId);
    if (existing) {
        existing.active = true;
        existing.activatedAt = Date.now();
        existing.activatedAtRound = this._data.inCombat ? this._data.combatRound : null;
        existing.roundsRemaining = this._data.inCombat
            ? CharacterSheetState.parseDurationToRounds(existing.duration) : null;
        return existing.id;
    }
    return this.addActiveState(stateTypeId, options);
}
```

### Combat Round Tracking

```javascript
// Start/end combat lifecycle
startCombat()              // Sets inCombat=true, combatRound=1, stamps activatedAtRound on active states
endCombat()                // Clears inCombat, combatRound, and all roundsRemaining/activatedAtRound

// Advance round — auto-deactivates expired states
const expired = advanceRound();  // Returns array of expired state names
// e.g. expired = ["Dodging"] after a 1-round Dodge expires

// Parse duration string to rounds
CharacterSheetState.parseDurationToRounds("1 minute")       // → 10
CharacterSheetState.parseDurationToRounds("Concentration, up to 10 minutes") // → 100
CharacterSheetState.parseDurationToRounds("Until ended")    // → null (indefinite)
```

### Deactivating States

```javascript
deactivateState(stateTypeId) {
    const state = this._data.activeStates.find(s => s.stateTypeId === stateTypeId);
    if (state) {
        state.active = false;
    }
}

removeActiveState(stateId) {
    const index = this._data.activeStates.findIndex(s => s.id === stateId);
    if (index !== -1) {
        this._data.activeStates.splice(index, 1);
    }
}
```
    
    return true;
}

deactivateStatesByType(stateTypeId) {
    const toRemove = this._data.activeStates.filter(s => s.stateTypeId === stateTypeId);
    toRemove.forEach(state => this.removeActiveState(state.id));
}
```

### Checking Active States

```javascript
isStateTypeActive(stateTypeId) {
    return this._data.activeStates.some(s => s.stateTypeId === stateTypeId);
}

getActiveStates() {
    return this._data.activeStates.map(state => ({
        ...state,
        stateType: CharacterSheetState.ACTIVE_STATE_TYPES[state.stateTypeId] ||
            CharacterSheetState.ACTIVE_STATE_TYPES.homebrewToggle,
    }));
}

getActiveStateEffects() {
    const effects = [];
    
    this._data.activeStates.forEach(state => {
        const stateType = CharacterSheetState.ACTIVE_STATE_TYPES[state.stateTypeId];
        if (!stateType) return;
        
        // Add base effects
        effects.push(...stateType.effects.map(e => ({
            ...e,
            source: state.name,
            stateId: state.id,
        })));
        
        // Add custom effects
        if (state.customEffects) {
            effects.push(...state.customEffects.map(e => ({
                ...e,
                source: state.name,
                stateId: state.id,
            })));
        }
    });
    
    return effects;
}
```

---

## Effect Application

### In AC Calculation

```javascript
getAc() {
    let ac = this._calculateBaseAc();
    
    // Apply active state effects
    const stateEffects = this.getActiveStateEffects();
    stateEffects.forEach(effect => {
        if (effect.type === "bonus" && effect.target === "ac") {
            if (effect.value) {
                ac += effect.value;
            } else if (effect.abilityMod) {
                ac += Math.max(1, this.getAbilityMod(effect.abilityMod));
            }
        }
    });
    
    return ac;
}
```

### In Attack Rolls

```javascript
_getAttackAdvantageStatus() {
    const stateEffects = this.getActiveStateEffects();
    
    let hasAdvantage = false;
    let hasDisadvantage = false;
    
    stateEffects.forEach(effect => {
        if (effect.type === "advantage" && effect.target?.startsWith("attack")) {
            hasAdvantage = true;
        }
        if (effect.type === "disadvantage" && effect.target?.startsWith("attack")) {
            hasDisadvantage = true;
        }
    });
    
    // Advantage and disadvantage cancel out
    if (hasAdvantage && hasDisadvantage) {
        return "normal";
    }
    return hasAdvantage ? "advantage" : hasDisadvantage ? "disadvantage" : "normal";
}
```

### In Damage Calculation

```javascript
_calculateMeleeDamageBonus() {
    let bonus = 0;
    
    // Check for rage damage
    if (this.isStateTypeActive("rage")) {
        const calc = this.getFeatureCalculations();
        bonus += calc.rageDamage || 0;
    }
    
    // Check other damage bonuses from active states
    const stateEffects = this.getActiveStateEffects();
    stateEffects.forEach(effect => {
        if (effect.type === "bonus" && effect.target === "damage:melee") {
            bonus += effect.value || 0;
        }
    });
    
    return bonus;
}
```

---

## UI Integration

### Toggle Controls

The UI renders toggle buttons for activatable features:

```javascript
_renderToggleControls() {
    const activatables = this._state.getActivatableFeatures();
    
    activatables.forEach(feature => {
        const isActive = this._state.isFeatureActive(feature.id);
        
        const $toggle = $(`
            <button class="charsheet__toggle ${isActive ? "active" : ""}" 
                    data-feature-id="${feature.id}"
                    data-state-type="${feature.stateTypeId}">
                <span class="charsheet__toggle-icon">${feature.icon}</span>
                <span class="charsheet__toggle-name">${feature.name}</span>
            </button>
        `);
        
        $toggle.click(() => this._onToggleClick(feature));
    });
}
```

### Active Effects Display

```javascript
_renderActiveEffects() {
    const $container = $("#charsheet-active-effects");
    $container.empty();
    
    const activeStates = this._state.getActiveStates();
    
    if (activeStates.length === 0) {
        $container.append(`<div class="charsheet__no-effects">No active effects</div>`);
        return;
    }
    
    activeStates.forEach(state => {
        const $effect = $(`
            <div class="charsheet__active-effect" data-state-id="${state.id}">
                <span class="charsheet__effect-icon">${state.stateType.icon}</span>
                <span class="charsheet__effect-name">${state.name}</span>
                <button class="charsheet__effect-remove" title="Deactivate">✕</button>
            </div>
        `);
        
        $effect.find(".charsheet__effect-remove").click(() => {
            this._state.removeActiveState(state.id);
            this._renderActiveEffects();
        });
        
        $container.append($effect);
    });
}
```

### Effect Summaries

`summarizeEffects()` produces human-readable labels from effect definitions, used in combat UI badges:

```javascript
CharacterSheetState.summarizeEffects(patientDefense.effects);
// → "Attacks against you have disadvantage; Advantage on DEX saves"
```

These labels appear in the combat panel when a state is active, providing at-a-glance visibility of mechanical effects.

### Patient Defense — Enhanced Display (Phase C/E)

Patient Defense is intentionally a **toggle state** (not a combat action) because its effects are ongoing and benefit from the state tracking system (round countdown, deactivation cleanup, effect aggregation).

**Visual feedback enhancements:**
- **Inline effect labels**: When Patient Defense is active, the combat panel shows "Attackers have disadvantage • Advantage on DEX saves"
- **`summarizeEffects()`** generates these labels from the `effects` array
- **Heightened Focus variant** (Monk XPHB L10): Also grants temp HP equal to `martialArtsDice + WIS mod` on Patient Defense activation
- **Deactivation**: `removeActiveState()` clears all effects, including temp HP if Heightened Focus granted it

**Test coverage** (in `CharacterSheetToggleAbilities.test.js`):
- State type definition shape (effects, resourceName, resourceCost, activationAction, duration)
- `summarizeEffects()` output string
- Activation via `activateState()` and `isStateTypeActive()` check
- Disadvantage on attacksAgainst present in effects array (note: `hasDisadvantageFromStates()` intentionally skips `attacksAgainst` — those affect enemies, not the player's rolls)
- Advantage on DEX saves via `hasAdvantageFromStates("save:dex")`
- Deactivation cleanup
- `analyzeToggleability()` recognition from feature text
- Heightened Focus temp HP formula

---

## Testing

The toggle abilities system has comprehensive test coverage:

### Test File Location
`test/jest/charactersheet/CharacterSheetToggleAbilities.test.js`

### Test Categories

1. **ACTIVE_STATE_TYPES validation** - Ensures all state types have required properties
2. **Detection tests** - Verifies correct identification of toggle abilities
3. **Activation/deactivation** - Tests state lifecycle management
4. **Effect application** - Verifies effects are correctly applied to calculations
5. **Resource consumption** - Tests that resources are properly consumed
6. **Class-specific tests** - Rage, Bladesong, Patient Defense, etc.

### Example Tests

```javascript
describe("Rage activation", () => {
    it("should activate rage and apply effects", () => {
        const state = createBarbarian(5);
        
        state.addActiveState("rage");
        
        expect(state.isStateTypeActive("rage")).toBe(true);
        
        const effects = state.getActiveStateEffects();
        expect(effects.some(e => e.type === "resistance" && e.target === "damage:bludgeoning")).toBe(true);
    });
    
    it("should consume a rage use", () => {
        const state = createBarbarian(5);
        const initialRages = state.getResourceCurrent("rage");
        
        state.addActiveState("rage");
        
        expect(state.getResourceCurrent("rage")).toBe(initialRages - 1);
    });
});
```

---

*Previous: [Spellcasting](./07-spellcasting.md) | Next: [Testing Strategy](./09-testing-strategy.md)*
