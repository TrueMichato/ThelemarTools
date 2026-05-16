# State Management Deep Dive

This document provides an in-depth exploration of `CharacterSheetState`, the heart of the character sheet system.

## Overview

`CharacterSheetState` is the largest module in the character sheet system (~16,315 lines). It serves as both the **data store** and **calculation engine** for all character mechanics.

## Core Data Structure (`_data`)

All character information is stored in a private `_data` object. Understanding this structure is essential for working with the state.

### Basic Information

```javascript
this._data = {
    // Identity
    name: "",                        // Character name
    race: null,                      // Race object from 5etools
    subrace: null,                   // Subrace if applicable
    background: null,                // Background object
    alignment: "",                   // Alignment string
    
    // Appearance & Personality
    appearance: "",
    personality: "",
    ideals: "",
    bonds: "",
    flaws: "",
}
```

### Class Structure

Classes are stored as an array, supporting multiclassing:

```javascript
classes: [
    {
        name: "Fighter",            // Class name
        source: "XPHB",             // Source book
        level: 5,                   // Levels in this class
        subclass: {                 // Subclass (null if not chosen)
            name: "Champion",
            shortName: "Champion",
            source: "XPHB"
        },
        hitDiceUsed: 2,             // Hit dice spent (for recovery)
        isStartingClass: true,      // First class taken
    },
    {
        name: "Rogue",
        source: "PHB",
        level: 3,
        subclass: {
            name: "Assassin",
            shortName: "Assassin",
            source: "PHB"
        },
        hitDiceUsed: 0,
        isStartingClass: false,
    }
]
```

### Ability Scores

Each ability score has multiple components for tracking different sources of bonuses:

```javascript
abilityScores: {
    str: {
        base: 15,              // Point-buy or rolled value
        racialBonus: 2,        // Bonus from race
        asiBonus: 0,           // From Ability Score Improvements
        miscBonus: 0,          // Items, feats, etc.
        overrideValue: null,   // Manual override (e.g., headband of intellect)
    },
    dex: {base: 14, racialBonus: 0, asiBonus: 2, miscBonus: 0, overrideValue: null},
    con: {base: 13, racialBonus: 1, asiBonus: 0, miscBonus: 0, overrideValue: null},
    int: {base: 10, racialBonus: 0, asiBonus: 0, miscBonus: 0, overrideValue: null},
    wis: {base: 12, racialBonus: 0, asiBonus: 0, miscBonus: 0, overrideValue: null},
    cha: {base: 8, racialBonus: 0, asiBonus: 0, miscBonus: 0, overrideValue: null},
}
```

### Hit Points

```javascript
hp: {
    current: 45,               // Current HP
    max: 45,                   // Maximum HP
    temp: 0,                   // Temporary HP
    maxModifier: 0,            // Bonus/penalty to max (e.g., from exhaustion)
},
hitDice: [
    {class: "Fighter", die: 10, max: 5, current: 3},
    {class: "Rogue", die: 8, max: 3, current: 3},
],
deathSaves: {
    successes: 0,
    failures: 0,
},
```

### Proficiencies

```javascript
// Saving Throws (array of ability abbreviations)
savingThrowProficiencies: ["str", "con"],

// Skills (array of skill names)
skillProficiencies: ["athletics", "intimidation", "perception", "stealth"],

// Expertise (double proficiency)
skillExpertise: ["stealth"],

// Tools
toolProficiencies: [
    {name: "Thieves' Tools", source: "Rogue"},
    {name: "Gaming Set (Dice)", source: "Background"},
],

// Languages
languageProficiencies: [
    {name: "Common", source: "Race"},
    {name: "Dwarvish", source: "Race"},
    {name: "Thieves' Cant", source: "Rogue"},
],

// Weapons (strings or patterns)
weaponProficiencies: ["simple", "martial"],

// Armor
armorProficiencies: ["light", "medium", "heavy", "shields"],
```

### Spellcasting

```javascript
// Regular spell slots
spellSlots: {
    1: {max: 4, current: 2},
    2: {max: 3, current: 3},
    3: {max: 2, current: 0},
    // ...
},

// Warlock pact magic
pactSlots: {
    level: 3,                  // Pact slot spell level
    max: 2,                    // Number of pact slots
    current: 1,                // Currently available
},

// Spell lists
knownSpells: ["magic missile", "shield", "fireball"],
preparedSpells: ["magic missile", "shield"],
alwaysPreparedSpells: ["bless", "cure wounds"],  // Domain, etc.
ritualSpells: ["detect magic", "identify"],

// Concentration tracking
concentration: {
    spellName: "bless",
    startTime: 1234567890,
    durationMinutes: 10,
},
```

### Inventory

```javascript
items: [
    {
        id: "item-1234",
        name: "Longsword",
        type: "weapon",
        quantity: 1,
        weight: 3,
        equipped: true,
        attuned: false,
        charges: null,
        notes: "",
        data: { /* full 5etools item data */ },
    },
    {
        id: "item-5678",
        name: "Plate Armor",
        type: "armor",
        quantity: 1,
        weight: 65,
        equipped: true,
        attuned: false,
        charges: null,
        notes: "",
        data: { /* full 5etools item data */ },
    },
],
currency: {
    cp: 0,
    sp: 50,
    ep: 0,
    gp: 150,
    pp: 2,
},
```

### Active States & Conditions

```javascript
// Toggle abilities (Rage, Bladesong, etc.)
activeStates: [
    {
        id: "rage-active-1",
        typeId: "rage",
        activatedAt: 1234567890,
        options: {
            totemSpirit: "bear",     // For Bear Totem Rage
        },
    },
],

// D&D Conditions
conditions: ["exhaustion-1", "frightened"],
exhaustionLevel: 1,

// Custom status effects
customStatuses: [
    {name: "Blessed", icon: "✨", description: "Under effects of Bless"},
],
```

---

## Computed Value Methods

The state provides many methods that calculate derived values from the raw data.

### Proficiency Bonus

```javascript
getProficiencyBonus() {
    const totalLevel = this.getTotalLevel();
    // Standard D&D proficiency bonus progression
    return Math.ceil(totalLevel / 4) + 1;
}
```

| Level | Proficiency Bonus |
|-------|-------------------|
| 1-4   | +2                |
| 5-8   | +3                |
| 9-12  | +4                |
| 13-16 | +5                |
| 17-20 | +6                |

### Ability Scores & Modifiers

```javascript
// Get total ability score
getAbilityScore(ability) {
    const scores = this._data.abilityScores[ability];
    if (scores.overrideValue !== null) return scores.overrideValue;
    return scores.base + scores.racialBonus + scores.asiBonus + scores.miscBonus;
}

// Get ability modifier
getAbilityMod(ability) {
    const score = this.getAbilityScore(ability);
    return Math.floor((score - 10) / 2);
}
```

### Armor Class

AC calculation is complex because it depends on armor type, class features, and active effects:

```javascript
getAc() {
    // Start with base AC
    let ac = 10;
    let dexCap = Infinity;
    
    // Check equipped armor
    const armor = this._getEquippedArmor();
    if (armor) {
        ac = armor.ac;
        dexCap = armor.dexCap ?? Infinity;
        
        // Medium armor caps DEX at +2
        if (armor.type === "medium") dexCap = 2;
        // Heavy armor ignores DEX
        if (armor.type === "heavy") dexCap = 0;
    } else {
        // Unarmored - check for Unarmored Defense
        const unarmoredAc = this._getUnarmoredDefenseAc();
        if (unarmoredAc > ac) ac = unarmoredAc;
    }
    
    // Add DEX modifier (capped if applicable)
    const dexMod = this.getAbilityMod("dex");
    ac += Math.min(dexMod, dexCap);
    
    // Shield bonus
    if (this._hasEquippedShield()) ac += 2;
    
    // Apply modifiers from items, features, active states
    ac += this._getAcModifiers();
    
    return ac;
}
```

### Unarmored Defense Variants

```javascript
_getUnarmoredDefenseAc() {
    const classes = this._data.classes;
    let bestAc = 10 + this.getAbilityMod("dex");
    
    // Barbarian: 10 + DEX + CON
    if (this.hasClass("Barbarian")) {
        const barbarianAc = 10 + this.getAbilityMod("dex") + this.getAbilityMod("con");
        if (barbarianAc > bestAc) bestAc = barbarianAc;
    }
    
    // Monk: 10 + DEX + WIS
    if (this.hasClass("Monk")) {
        const monkAc = 10 + this.getAbilityMod("dex") + this.getAbilityMod("wis");
        if (monkAc > bestAc) bestAc = monkAc;
    }
    
    // Draconic Sorcerer: 13 + DEX
    if (this.hasSubclass("Draconic Bloodline")) {
        const draconicAc = 13 + this.getAbilityMod("dex");
        if (draconicAc > bestAc) bestAc = draconicAc;
    }
    
    return bestAc;
}
```

### Initiative

```javascript
getInitiativeMod() {
    let initiative = this.getAbilityMod("dex");
    
    // Feature bonuses
    const calc = this.getFeatureCalculations();
    
    // Swashbuckler: add CHA
    if (calc.hasRakishAudacity) {
        initiative += this.getAbilityMod("cha");
    }
    
    // Alert feat: +5 (PHB) or +prof (XPHB)
    if (this.hasFeat("Alert")) {
        initiative += this._isXphbAlert() ? this.getProficiencyBonus() : 5;
    }
    
    // Apply item/feature modifiers
    initiative += this._getInitiativeModifiers();
    
    return initiative;
}
```

### Spell Save DC & Attack Bonus

```javascript
getSpellSaveDc(className) {
    const cls = this._getClass(className);
    if (!cls) return 8 + this.getProficiencyBonus();
    
    const ability = this._getSpellcastingAbility(className);
    return 8 + this.getProficiencyBonus() + this.getAbilityMod(ability);
}

getSpellAttackBonus(className) {
    const cls = this._getClass(className);
    if (!cls) return this.getProficiencyBonus();
    
    const ability = this._getSpellcastingAbility(className);
    return this.getProficiencyBonus() + this.getAbilityMod(ability);
}

_getSpellcastingAbility(className) {
    const abilityMap = {
        "Wizard": "int",
        "Artificer": "int",
        "Cleric": "wis",
        "Druid": "wis",
        "Ranger": "wis",
        "Monk": "wis",
        "Sorcerer": "cha",
        "Warlock": "cha",
        "Bard": "cha",
        "Paladin": "cha",
    };
    return abilityMap[className] || "int";
}
```

---

## Feature Calculations System

The `getFeatureCalculations()` method is the most important method in the state. It computes all class-specific mechanics based on current levels and choices.

### Return Value Structure

```javascript
{
    // Barbarian
    hasRage: true,
    rageDamage: 2,
    ragesPerDay: 3,
    
    // Rogue
    sneakAttack: {dice: "3d6", avgDamage: 10},
    hasUncannyDodge: true,
    hasEvasion: true,
    
    // Monk
    kiPoints: 5,
    kiSaveDc: 14,
    martialArtsDie: "1d6",
    
    // Fighter
    superiorityDice: 4,
    superiorityDieSize: "d8",
    maneuverSaveDc: 15,
    
    // Wizard
    arcaneRecoverySlots: 3,
    
    // Warlock
    eldritchInvocationsKnown: 4,
    
    // ... all other class features
}
```

### Class-Specific Calculations

The method uses a large switch statement on class name:

```javascript
getFeatureCalculations() {
    const classes = this._data.classes || [];
    const profBonus = this.getProficiencyBonus();
    const calculations = {};

    classes.forEach(cls => {
        const className = cls.name;
        const level = cls.level || 1;
        const source = cls.source || "PHB";
        const is2024 = source === "XPHB";

        switch (className) {
            case "Barbarian":
                // Rage calculations
                calculations.hasRage = true;
                calculations.rageDamage = level >= 16 ? 4 : level >= 9 ? 3 : 2;
                calculations.ragesPerDay = level >= 20 ? Infinity : 
                    level >= 17 ? 6 : level >= 12 ? 5 : level >= 6 ? 4 : 
                    level >= 3 ? 3 : 2;
                
                // Brutal Critical
                if (level >= 9) {
                    calculations.brutalCritical = level >= 17 ? 3 : 
                        level >= 13 ? 2 : 1;
                }
                
                // Subclass features...
                break;
                
            case "Fighter":
                // Fighting Style (level 1)
                calculations.hasFightingStyle = true;
                
                // Second Wind (level 1)
                calculations.hasSecondWind = true;
                calculations.secondWindHealing = `1d10+${level}`;
                
                // Action Surge (level 2)
                if (level >= 2) {
                    calculations.hasActionSurge = true;
                    calculations.actionSurgeUses = level >= 17 ? 2 : 1;
                }
                
                // Extra Attack progression
                if (level >= 5) {
                    calculations.hasExtraAttack = true;
                    calculations.extraAttacks = level >= 20 ? 3 : 
                        level >= 11 ? 2 : 1;
                }
                
                // Indomitable (level 9)
                if (level >= 9) {
                    calculations.hasIndomitable = true;
                    calculations.indomitableUses = level >= 17 ? 3 : 
                        level >= 13 ? 2 : 1;
                }
                
                // Subclass (Champion, Battle Master, etc.)...
                break;
                
            // ... all other classes
        }
    });

    return calculations;
}
```

### 2014 vs 2024 Rules

The method handles differences between PHB (2014) and XPHB (2024):

```javascript
case "Monk":
    const is2024 = source === "XPHB";
    
    // Martial Arts die differs by edition
    if (is2024) {
        // XPHB starts at d6
        martialArtsDice = level >= 17 ? "1d12" : level >= 11 ? "1d10" : 
            level >= 5 ? "1d8" : "1d6";
    } else {
        // PHB starts at d4
        martialArtsDice = level >= 17 ? "1d10" : level >= 11 ? "1d8" : 
            level >= 5 ? "1d6" : "1d4";
    }
    
    // Feature names differ
    calculations.kiPoints = level;      // PHB name
    calculations.focusPoints = level;   // XPHB name (same value)
    
    // Some features moved to different levels
    if (is2024 && level >= 7) {
        calculations.hasReliableTalent = true;  // Moved from 11 to 7
    } else if (!is2024 && level >= 11) {
        calculations.hasReliableTalent = true;
    }
```

---

## Parser Utilities

The state module includes several parser classes for extracting information from feature text.

### FeatureUsesParser

Extracts limited-use information from feature descriptions:

```javascript
FeatureUsesParser.parseUses(
    "You can use this feature twice, and regain uses on a short rest.",
    getAbilityMod,
    getProficiencyBonus
);
// Returns: {max: 2, recharge: "short"}

FeatureUsesParser.parseUses(
    "You can use this a number of times equal to your proficiency bonus per long rest.",
    getAbilityMod,
    () => 4
);
// Returns: {max: 4, recharge: "long"}
```

### NaturalWeaponParser

Extracts natural weapon attacks from racial/class features:

```javascript
NaturalWeaponParser.parseNaturalWeapon(
    "You have talons. Your talons are natural weapons, which you can use to make unarmed strikes. When you hit with them, the strike deals 1d6 + your Strength modifier slashing damage.",
    "Talons"
);
// Returns: {
//     name: "Talons",
//     isMelee: true,
//     isNaturalWeapon: true,
//     abilityMod: "str",
//     damage: "1d6",
//     damageType: "slashing",
//     range: "5 ft",
//     properties: []
// }
```

### SpellGrantParser

Extracts spells granted by features/races/feats:

```javascript
// From structured additionalSpells data
SpellGrantParser.parseAdditionalSpells(
    [{innate: {daily: {"1": ["misty step"]}}}],
    "Fey Ancestry"
);
// Returns: [{
//     name: "Misty Step",
//     source: "PHB",
//     innate: true,
//     uses: 1,
//     recharge: "long",
//     sourceFeature: "Fey Ancestry"
// }]

// From feature text (fallback)
SpellGrantParser.parseSpellsFromText(
    "You can cast {@spell detect magic} at will.",
    "Magic Initiate"
);
```

### FeatureModifierParser

Extracts numeric modifiers from feature/item text:

```javascript
FeatureModifierParser.parseModifiers(
    "While wearing this armor, you have a +1 bonus to AC.",
    "Armor +1"
);
// Returns: [{type: "ac", value: 1, note: "Armor +1"}]

FeatureModifierParser.parseModifiers(
    "You have advantage on Strength checks and Strength saving throws.",
    "Rage"
);
// Returns: [
//     {type: "advantage", target: "check:str", note: "Rage"},
//     {type: "advantage", target: "save:str", note: "Rage"}
// ]
```

---

## State Persistence

### Saving

```javascript
toJSON() {
    return JSON.stringify(this._data, null, 2);
}

getSaveData() {
    return {
        version: CharacterSheetState.SAVE_VERSION,
        timestamp: Date.now(),
        data: this._data,
    };
}
```

### Loading

```javascript
static fromJSON(json) {
    const state = new CharacterSheetState();
    const parsed = JSON.parse(json);
    
    // Handle version migration
    const migrated = CharacterSheetState.migrate(parsed);
    
    state._data = migrated.data;
    return state;
}

static migrate(saveData) {
    let data = saveData;
    
    // Apply migrations from old versions
    if (data.version < 2) {
        data = CharacterSheetState._migrateV1ToV2(data);
    }
    if (data.version < 3) {
        data = CharacterSheetState._migrateV2ToV3(data);
    }
    // ... more migrations
    
    return data;
}
```

---

## Event System

The state emits events when data changes, allowing the UI to react:

```javascript
// In state
setName(name) {
    this._data.name = name;
    this._emit("nameChanged", name);
}

addClass(classObj) {
    this._data.classes.push(classObj);
    this._emit("classAdded", classObj);
    this._emit("levelChanged", this.getTotalLevel());
}

// In UI component
state.on("levelChanged", (newLevel) => {
    this._renderProficiencyBonus();
    this._renderFeatures();
});
```

---

## Auxiliary State Slices

Beyond the core character data, `_data` holds several smaller slices that have their own getter/setter API.

### `_data.favorites[]`

User-starred features/spells/attacks/items. See [Components Reference → Favorites System](./03-components-reference.md#favorites-system) for the shape and full API (`addFavorite` / `removeFavorite` / `toggleFavorite` / `isFavorite` / `_resolveFavorite` / `getOrphanedFavorites` / `cleanupOrphanedFavorites`). Cap = 8. Stable IDs are `"type:idSuffix"`.

### `_data.loreSkills[]` (TGTT)

TGTT variant rule. Each entry: `{name: string, bonus: number}`. Flat per-skill bonus (PB is added on top by the roll handler, no ability/PB scaling otherwise).

| Method | Purpose |
|---|---|
| `getLoreSkills()` | Returns the array (may be empty) |
| `setLoreSkillBonus(name, bonus)` | Upsert; bonus floored at 0 |
| `removeLoreSkill(name)` | Delete by name |

Gated by the standard TGTT settings flag — non-TGTT characters never render the section.

### `settings.skipConditionalPrompt`

When `true`, the conditional-modifier picker is suppressed and no conditional modifiers auto-apply. Roll handlers still aggregate non-conditional modifiers normally. Toggled from the dice settings dropdown.

## Modifier Aggregation API

`aggregateModifiers(type, {appliedConditionalIds?} = {})` is the canonical entry point for combining all bonuses of a given `type` (e.g. `"save:dex"`, `"skill:perception"`, `"ac"`).

### Return shape

```javascript
{
    bonus,                  // Combined numeric bonus (deterministic)
    advantage,              // True if any non-conditional source grants advantage
    disadvantage,           // True if any non-conditional source grants disadvantage
    minimum,                // Floor (e.g. Silver Tongue "minimum 10")
    maximum,                // Cap
    bonusDice,              // Array of "+1d4"-style entries
    conditionalsAvailable: [ // Surfaced for the pre-roll picker
        {id, name, conditional, advantage?, disadvantage?, bonus?, target?},
    ],
}
```

### `appliedConditionalIds`

A `Set<string>` of conditional modifier IDs (from `_buildConditionalModId`) that the caller has opted in. Only those are folded into `bonus` / `advantage` / `disadvantage`; the rest still surface in `conditionalsAvailable` for inspection. **Default is empty** — conditionals are gated off by default to prevent the "Dauntless Heritage applies to every save" class of bug.

`getAdvantageState(type, opts)` and `getModifierBonus(type, opts)` forward `opts` unchanged.

---

*Previous: [Components Reference](./03-components-reference.md) | Next: [Feature Calculations](./05-feature-calculations.md)*
