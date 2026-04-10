# Combat System

This document details the combat management system in the character sheet.

## Overview

The `CharacterSheetCombat` module handles all combat-related functionality:
- Attack management (create, edit, delete, roll)
- Initiative rolling
- Death saves
- Condition tracking
- Combat Methods (TGTT stamina system)

**File**: `js/charactersheet/charactersheet-combat.js`  
**Lines**: ~3,028

---

## Core Classes

### CharacterSheetCombat

Main combat controller that manages all combat interactions.

```javascript
class CharacterSheetCombat {
    constructor(page) {
        this._page = page;           // CharacterSheetPage reference
        this._state = page.getState(); // CharacterSheetState
        this._allItems = [];         // Weapons from item data
        this._cachedAttacks = [];    // Computed attack list
    }
}
```

---

## Attacks

### Attack Data Structure

```javascript
{
    id: "attack-1234",           // Unique identifier
    name: "Longsword",           // Display name
    attackBonus: 5,              // Total attack modifier
    damage: "1d8",               // Damage dice
    damageType: "slashing",      // Damage type
    damageBonus: 3,              // Bonus to damage
    range: "5 ft",               // Range string
    properties: ["versatile"],   // Weapon properties
    isMelee: true,               // Melee vs ranged
    abilityMod: "str",           // Ability for attack/damage
    source: "weapon",            // weapon, spell, feature
    isNaturalWeapon: false,      // From race/class feature
    sourceFeature: null,         // Feature name if applicable
}
```

### Creating Attacks

The attack creator modal allows manual creation or selection from equipment:

```javascript
async _pShowAttackModal(existingAttack = null) {
    const {$modalInner, doClose} = await UiUtil.pGetShowModal({
        title: isEdit ? "Edit Attack" : "Add Attack",
    });
    
    // Form fields:
    // - Name
    // - Type (melee/ranged)
    // - Ability modifier
    // - Attack bonus
    // - Damage dice
    // - Damage type
    // - Range
    // - Properties
}
```

### Quick Weapon Selection

Players can quickly add attacks from their equipped weapons:

```javascript
_renderWeaponQuickSelect($container) {
    const weapons = this._state.getEquippedWeapons();
    
    weapons.forEach(weapon => {
        const attackBonus = this._calculateWeaponAttackBonus(weapon);
        const damage = this._getWeaponDamage(weapon);
        
        // Create button to add weapon as attack
    });
}
```

### Attack Bonus Calculation

```javascript
_calculateWeaponAttackBonus(weapon) {
    let bonus = this._state.getProficiencyBonus();
    
    // Determine ability modifier
    if (weapon.isRanged) {
        bonus += this._state.getAbilityMod("dex");
    } else if (weapon.properties?.includes("finesse")) {
        // Use higher of STR or DEX
        bonus += Math.max(
            this._state.getAbilityMod("str"),
            this._state.getAbilityMod("dex")
        );
    } else {
        bonus += this._state.getAbilityMod("str");
    }
    
    // Magic weapon bonus
    if (weapon.bonusWeapon) {
        bonus += weapon.bonusWeapon;
    }
    
    // Active state modifiers (Rage, Bladesong, etc.)
    bonus += this._getAttackModifiersFromActiveStates();
    
    return bonus;
}
```

### Rolling Attacks

Attack rolls support advantage/disadvantage via modifier keys:

```javascript
_rollAttack(attackId, event) {
    const attack = this._getAttackById(attackId);
    if (!attack) return;
    
    const isAdvantage = event.shiftKey;
    const isDisadvantage = event.ctrlKey || event.metaKey;
    
    // Roll the d20(s)
    const roll1 = Renderer.dice.randomNumber(1, 20);
    const roll2 = (isAdvantage || isDisadvantage) 
        ? Renderer.dice.randomNumber(1, 20) 
        : null;
    
    // Determine which to use
    let finalRoll = roll1;
    if (isAdvantage && roll2 !== null) {
        finalRoll = Math.max(roll1, roll2);
    } else if (isDisadvantage && roll2 !== null) {
        finalRoll = Math.min(roll1, roll2);
    }
    
    // Calculate total
    const total = finalRoll + attack.attackBonus;
    
    // Check for critical hit/miss
    const isCritical = this._isCriticalHit(finalRoll, attack);
    const isCriticalMiss = finalRoll === 1;
    
    // Display result
    this._displayAttackRoll(attack, {
        roll1, roll2, finalRoll, total,
        isAdvantage, isDisadvantage,
        isCritical, isCriticalMiss,
    });
}
```

### Critical Hit Detection

Accounts for features like Champion's Improved Critical:

```javascript
_isCriticalHit(roll, attack) {
    const calc = this._state.getFeatureCalculations();
    
    // Default critical range
    let critRange = 20;
    
    // Improved Critical (Champion Fighter)
    if (calc.improvedCriticalRange) {
        critRange = calc.improvedCriticalRange;
    }
    
    // Hexblade's Curse
    if (this._state.isStateTypeActive("hexbladescurse")) {
        critRange = Math.min(critRange, 19);
    }
    
    return roll >= critRange;
}
```

### Rolling Damage

```javascript
_rollDamage(attackId, isCritical = false) {
    const attack = this._getAttackById(attackId);
    if (!attack) return;
    
    // Parse damage dice
    const diceResult = this._rollDamageDice(attack.damage, isCritical);
    
    // Add damage bonus
    let totalDamage = diceResult.total + attack.damageBonus;
    
    // Rage damage bonus
    const calc = this._state.getFeatureCalculations();
    if (this._state.isStateTypeActive("rage") && attack.isMelee) {
        totalDamage += calc.rageDamage || 0;
    }
    
    // Sneak Attack (if applicable)
    if (this._canApplySneakAttack(attack)) {
        const sneakDamage = this._rollSneakAttack(isCritical);
        totalDamage += sneakDamage.total;
    }
    
    // Display result
    this._displayDamageRoll(attack, {
        diceResult,
        bonusDamage: attack.damageBonus,
        rageDamage: calc.rageDamage,
        totalDamage,
        damageType: attack.damageType,
    });
}
```

---

## Initiative

### Rolling Initiative

```javascript
_rollInitiative(event) {
    const isAdvantage = event.shiftKey;
    const isDisadvantage = event.ctrlKey || event.metaKey;
    
    // Base initiative modifier
    let mod = this._state.getInitiativeMod();
    
    // Roll
    const roll1 = Renderer.dice.randomNumber(1, 20);
    const roll2 = (isAdvantage || isDisadvantage) 
        ? Renderer.dice.randomNumber(1, 20) 
        : null;
    
    let finalRoll = roll1;
    if (isAdvantage) finalRoll = Math.max(roll1, roll2);
    if (isDisadvantage) finalRoll = Math.min(roll1, roll2);
    
    const total = finalRoll + mod;
    
    // Update state
    this._state.setCurrentInitiative(total);
    
    // Feral Instinct: advantage on initiative rolls
    // (Handled by UI allowing shift-click)
    
    // Display result
    this._displayInitiativeRoll({
        roll1, roll2, finalRoll, mod, total,
        isAdvantage, isDisadvantage,
    });
}
```

### Initiative Modifiers

Several features affect initiative:

```javascript
// In CharacterSheetState.getInitiativeMod()
getInitiativeMod() {
    let mod = this.getAbilityMod("dex");
    
    const calc = this.getFeatureCalculations();
    
    // Swashbuckler's Rakish Audacity
    if (calc.hasRakishAudacity) {
        mod += this.getAbilityMod("cha");
    }
    
    // Alert feat
    if (this.hasFeat("Alert")) {
        mod += this._isXphbFeat("Alert") 
            ? this.getProficiencyBonus() 
            : 5;
    }
    
    // Gift of Alacrity
    if (this._hasActiveSpellEffect("gift of alacrity")) {
        mod += 5; // Actually adds 1d8 to roll
    }
    
    // Aura of the Sentinel (Watchers Paladin)
    if (calc.hasAuraOfTheSentinel) {
        mod += this.getProficiencyBonus();
    }
    
    return mod;
}
```

---

## Death Saves

### Tracking Death Saves

```javascript
// In CharacterSheetState
_data.deathSaves = {
    successes: 0,  // 0-3
    failures: 0,   // 0-3
};
```

### Rolling Death Saves

```javascript
_rollDeathSave(isSuccess) {
    const current = this._state.getDeathSaves();
    
    if (isSuccess) {
        const newSuccesses = current.successes + 1;
        this._state.setDeathSaveSuccesses(newSuccesses);
        
        if (newSuccesses >= 3) {
            // Stabilized!
            JqueryUtil.doToast({
                type: "success",
                content: "Stabilized! You regain consciousness with 1 HP.",
            });
            this._state.setHp(1);
            this._resetDeathSaves();
        }
    } else {
        const newFailures = current.failures + 1;
        this._state.setDeathSaveFailures(newFailures);
        
        if (newFailures >= 3) {
            // Dead
            JqueryUtil.doToast({
                type: "danger",
                content: "You have died.",
            });
        }
    }
    
    this._renderDeathSaves();
}
```

### Special Death Save Rules

```javascript
// Critical on death save roll
_handleDeathSaveRoll() {
    const roll = Renderer.dice.randomNumber(1, 20);
    
    if (roll === 20) {
        // Natural 20: Regain 1 HP
        this._state.setHp(1);
        this._resetDeathSaves();
        JqueryUtil.doToast({
            type: "success",
            content: "Natural 20! You regain 1 HP and regain consciousness!",
        });
    } else if (roll === 1) {
        // Natural 1: Two failures
        this._rollDeathSave(false);
        this._rollDeathSave(false);
    } else if (roll >= 10) {
        this._rollDeathSave(true);
    } else {
        this._rollDeathSave(false);
    }
}
```

---

## Conditions

### Standard D&D Conditions

```javascript
static CONDITION_EFFECTS = {
    blinded: {
        name: "Blinded",
        icon: "👁️‍🗨️",
        effects: [
            {type: "disadvantage", target: "attack"},
            {type: "advantage", target: "attacksAgainst"},
            {type: "autoFail", target: "check:sight"},
        ],
    },
    charmed: {
        name: "Charmed",
        icon: "💕",
        effects: [
            {type: "cantAttack", target: "charmer"},
            {type: "advantage", target: "social:charmer"},
        ],
    },
    deafened: {
        name: "Deafened",
        icon: "🔇",
        effects: [
            {type: "autoFail", target: "check:hearing"},
        ],
    },
    frightened: {
        name: "Frightened",
        icon: "😨",
        effects: [
            {type: "disadvantage", target: "attack:frightener"},
            {type: "disadvantage", target: "check:frightener"},
            {type: "cantApproach", target: "frightener"},
        ],
    },
    grappled: {
        name: "Grappled",
        icon: "🤼",
        effects: [
            {type: "speed", value: 0},
        ],
    },
    incapacitated: {
        name: "Incapacitated",
        icon: "💫",
        effects: [
            {type: "cantAct", target: "actions"},
            {type: "cantAct", target: "reactions"},
        ],
    },
    invisible: {
        name: "Invisible",
        icon: "👻",
        effects: [
            {type: "advantage", target: "attack"},
            {type: "disadvantage", target: "attacksAgainst"},
        ],
    },
    paralyzed: {
        name: "Paralyzed",
        icon: "⚡",
        effects: [
            {type: "incapacitated"},
            {type: "autoFail", target: "save:str"},
            {type: "autoFail", target: "save:dex"},
            {type: "advantage", target: "attacksAgainst"},
            {type: "autoCrit", target: "hitsWithin5ft"},
        ],
    },
    petrified: {
        name: "Petrified",
        icon: "🗿",
        effects: [
            {type: "incapacitated"},
            {type: "resistance", target: "all"},
            {type: "immunity", target: "poison"},
            {type: "immunity", target: "disease"},
        ],
    },
    poisoned: {
        name: "Poisoned",
        icon: "🤢",
        effects: [
            {type: "disadvantage", target: "attack"},
            {type: "disadvantage", target: "check:all"},
        ],
    },
    prone: {
        name: "Prone",
        icon: "🛌",
        effects: [
            {type: "disadvantage", target: "attack"},
            {type: "advantage", target: "attacksWithin5ft"},
            {type: "disadvantage", target: "attacksBeyond5ft"},
        ],
    },
    restrained: {
        name: "Restrained",
        icon: "⛓️",
        effects: [
            {type: "speed", value: 0},
            {type: "disadvantage", target: "attack"},
            {type: "disadvantage", target: "save:dex"},
            {type: "advantage", target: "attacksAgainst"},
        ],
    },
    stunned: {
        name: "Stunned",
        icon: "😵",
        effects: [
            {type: "incapacitated"},
            {type: "cantMove"},
            {type: "autoFail", target: "save:str"},
            {type: "autoFail", target: "save:dex"},
            {type: "advantage", target: "attacksAgainst"},
        ],
    },
    unconscious: {
        name: "Unconscious",
        icon: "😴",
        effects: [
            {type: "incapacitated"},
            {type: "cantMove"},
            {type: "prone"},
            {type: "autoFail", target: "save:str"},
            {type: "autoFail", target: "save:dex"},
            {type: "advantage", target: "attacksAgainst"},
            {type: "autoCrit", target: "hitsWithin5ft"},
        ],
    },
};
```

### Exhaustion (2014 Rules)

```javascript
static EXHAUSTION_2014 = {
    1: {effects: [{type: "disadvantage", target: "check:all"}]},
    2: {effects: [{type: "speed", value: "half"}]},
    3: {effects: [{type: "disadvantage", target: "attack"}, {type: "disadvantage", target: "save:all"}]},
    4: {effects: [{type: "hp", value: "half"}]},
    5: {effects: [{type: "speed", value: 0}]},
    6: {effects: [{type: "death"}]},
};
```

### Exhaustion (2024 Rules)

```javascript
static EXHAUSTION_2024 = {
    // Each level: -2 to d20 tests and spell save DCs
    1: {effects: [{type: "d20penalty", value: -2}, {type: "spellDcPenalty", value: -2}]},
    2: {effects: [{type: "d20penalty", value: -4}, {type: "spellDcPenalty", value: -4}, {type: "speed", value: "half"}]},
    3: {effects: [{type: "d20penalty", value: -6}, {type: "spellDcPenalty", value: -6}, {type: "speed", value: "half"}]},
    4: {effects: [{type: "d20penalty", value: -8}, {type: "spellDcPenalty", value: -8}, {type: "speed", value: "half"}]},
    5: {effects: [{type: "d20penalty", value: -10}, {type: "spellDcPenalty", value: -10}, {type: "speed", value: "half"}]},
    6: {effects: [{type: "death"}]},
};
```

### Managing Conditions

```javascript
async _onAddCondition() {
    const conditions = Object.keys(CharacterSheetState.CONDITION_EFFECTS);
    
    const {$modalInner, doClose} = await UiUtil.pGetShowModal({
        title: "Add Condition",
    });
    
    // Show list of conditions with icons
    conditions.forEach(condKey => {
        const cond = CharacterSheetState.CONDITION_EFFECTS[condKey];
        // Create clickable condition option
    });
}

_addCondition(conditionKey) {
    this._state.addCondition(conditionKey);
    this.renderCombatConditions();
    this.renderCombatEffects();
    this._page.saveCharacter();
}

_removeCondition(conditionKey) {
    this._state.removeCondition(conditionKey);
    this.renderCombatConditions();
    this.renderCombatEffects();
    this._page.saveCharacter();
}
```

---

## Combat Methods (TGTT Stamina System)

The sheet supports the "Trials & Treasures" (TGTT) combat methods system, which uses stamina points.

### Stamina Pool

```javascript
// In state
_data.stamina = {
    current: 0,
    max: 0,  // Typically = proficiency bonus
};
```

### Combat Methods

```javascript
_useMethod(methodId) {
    const method = this._getMethodById(methodId);
    if (!method) return;
    
    // Check stamina cost
    if (method.staminaCost > this._state.getStaminaCurrent()) {
        JqueryUtil.doToast({
            type: "warning",
            content: `Not enough stamina! Need ${method.staminaCost}, have ${this._state.getStaminaCurrent()}.`,
        });
        return;
    }
    
    // Spend stamina
    this._state.spendStamina(method.staminaCost);
    
    // Apply method effect
    this._applyMethodEffect(method);
    
    // Update display
    this._renderStamina();
}
```

---

## Combat Tab Rendering

The combat tab displays:

1. **Attacks Section**: All configured attacks with roll buttons
2. **Initiative**: Current initiative with roll button
3. **Active States**: Current toggles (Rage, Bladesong, etc.)
4. **Conditions**: Active conditions with effects
5. **Death Saves**: Tracker with success/failure buttons
6. **Combat Spells**: Quick access to commonly used combat spells
7. **Defenses**: AC, resistances, immunities

```javascript
renderCombatTab() {
    this.renderAttacks();
    this.renderInitiative();
    this.renderCombatStates();
    this.renderCombatConditions();
    this.renderDeathSaves();
    this.renderCombatSpells();
    this.renderCombatDefenses();
}
```

---

## Integration Points

### With CharacterSheetState

```javascript
// Read attack data
const attacks = this._state.getAttacks();

// Get computed values
const ac = this._state.getAc();
const initiative = this._state.getInitiativeMod();

// Check active states
const isRaging = this._state.isStateTypeActive("rage");

// Get feature calculations
const calc = this._state.getFeatureCalculations();
```

### With CharacterSheetSpells

```javascript
// Cast combat spell
async _castCombatSpell(spellId) {
    if (this._page._spells) {
        await this._page._spells._castSpell(spellId);
        this.renderCombatSpells();
    }
}
```

### With Main Page

```javascript
// Save after changes
this._page.saveCharacter();

// Delegate condition management
this._page._onAddCondition?.();
```

---

*Previous: [Feature Calculations](./05-feature-calculations.md) | Next: [Spellcasting](./07-spellcasting.md)*
