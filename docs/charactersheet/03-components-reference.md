# Components Reference

This document provides a detailed reference for each component in the character sheet system.

## CharacterSheetPage

**File**: `js/charactersheet/charactersheet.js`  
**Lines**: ~5,861  
**Role**: Main Controller

### Constructor

```javascript
constructor() {
    this._state = new CharacterSheetState();
    this._builder = null;
    this._combat = null;
    this._spells = null;
    this._inventory = null;
    this._features = null;
    this._rest = null;
    this._export = null;
    this._levelUp = null;
    this._layout = null;
    
    // Data caches
    this._races = [];
    this._classes = [];
    this._subclasses = [];
    // ... more caches
}
```

### Key Methods

| Method | Description |
|--------|-------------|
| `pInit()` | Async initialization - loads data, creates UI, initializes modules |
| `_pLoadData()` | Loads all 5etools JSON data files |
| `_initUi()` | Creates DOM elements for the sheet |
| `_initEventListeners()` | Binds all event handlers |
| `getState()` | Returns the CharacterSheetState instance |
| `saveCharacter()` | Persists current character to localStorage |
| `loadCharacter(id)` | Loads a character by ID |
| `renderAll()` | Re-renders entire UI |
| `rollDice(count, sides)` | Utility for dice rolling |

### Data Caches

The page maintains caches for quick access to 5etools data:

```javascript
this._races = [];              // All races/species
this._classes = [];            // All classes
this._subclasses = [];         // All subclasses
this._classFeatures = [];      // All class features
this._subclassFeatures = [];   // All subclass features
this._backgrounds = [];        // All backgrounds
this._spellsData = [];         // All spells
this._itemsData = [];          // All items
this._featsData = [];          // All feats
this._optionalFeaturesData = []; // Invocations, maneuvers, etc.
this._skillsData = [];         // Skill definitions
this._conditionsData = [];     // Condition definitions
this._languagesData = [];      // Language definitions
```

---

## CharacterSheetState

**File**: `js/charactersheet/charactersheet-state.js`  
**Lines**: ~16,315  
**Role**: Data Model & Calculation Engine

### Data Structure

```javascript
this._data = {
    // Basic Info
    name: "",
    race: null,
    background: null,
    alignment: "",
    
    // Classes
    classes: [],  // [{name, level, subclass, source, hitDiceUsed}]
    
    // Ability Scores
    abilityScores: {
        str: {base: 10, racialBonus: 0, asiBonus: 0, miscBonus: 0},
        dex: {base: 10, racialBonus: 0, asiBonus: 0, miscBonus: 0},
        // ... con, int, wis, cha
    },
    
    // Hit Points
    hp: {current: 0, max: 0, temp: 0},
    hitDice: [],  // [{type: "Fighter", die: 10, max: 1, current: 1}]
    
    // Death Saves
    deathSaves: {successes: 0, failures: 0},
    
    // Proficiencies
    savingThrowProficiencies: [],
    skillProficiencies: [],
    toolProficiencies: [],
    languageProficiencies: [],
    weaponProficiencies: [],
    armorProficiencies: [],
    
    // Expertise
    skillExpertise: [],
    
    // Spells
    spellSlots: {},       // {1: {max: 4, current: 4}, ...}
    pactSlots: {},        // Warlock pact magic
    knownSpells: [],
    preparedSpells: [],
    
    // Inventory
    items: [],
    currency: {cp: 0, sp: 0, ep: 0, gp: 0, pp: 0},
    
    // Features
    features: [],
    feats: [],
    
    // Active States
    activeStates: [],     // Rage, Bladesong, etc.
    conditions: [],       // Blinded, Poisoned, etc.
    
    // Custom Modifiers
    customModifiers: {
        ac: 0,
        initiative: 0,
        speed: {walk: 0, fly: 0, swim: 0, climb: 0},
        // ... more
    },
    
    // Attacks
    attacks: [],
    
    // Notes
    notes: "",
    
    // Resources
    resources: [],        // Custom trackable resources
};
```

### Static Properties

#### ACTIVE_STATE_TYPES

Predefined toggle states with their effects:

```javascript
static ACTIVE_STATE_TYPES = {
    rage: {
        id: "rage",
        name: "Rage",
        icon: "💢",
        effects: [
            {type: "advantage", target: "check:str"},
            {type: "advantage", target: "save:str"},
            {type: "resistance", target: "damage:bludgeoning"},
            // ...
        ],
        duration: "1 minute",
        endConditions: ["No attack for 1 turn", "Unconscious"],
    },
    bladesong: { /* ... */ },
    combatStance: { /* ... */ },
    // ... more state types
};
```

#### CONDITION_EFFECTS

Standard D&D conditions and their mechanical effects:

```javascript
static CONDITION_EFFECTS = {
    blinded: {
        name: "Blinded",
        icon: "👁️‍🗨️",
        effects: [
            {type: "disadvantage", target: "attack"},
            {type: "advantage", target: "attacksAgainst"},
        ],
    },
    // ... more conditions
};
```

### Key Instance Methods

#### Basic Getters/Setters

```javascript
// Name
getName()
setName(name)

// Race
getRace()
setRace(race)

// Classes
getClasses()
addClass(classObj)
removeClass(className)
getTotalLevel()
getClassLevel(className)
```

#### Ability Scores

```javascript
// Get total score (base + all bonuses)
getAbilityScore(ability)  // e.g., getAbilityScore("str")

// Get modifier (Math.floor((score - 10) / 2))
getAbilityMod(ability)

// Set components
setAbilityBase(ability, value)
setAbilityRacialBonus(ability, value)
setAbilityAsiBonus(ability, value)
setAbilityMiscBonus(ability, value)
```

#### Computed Values

```javascript
// Proficiency bonus based on total level
getProficiencyBonus()

// Armor Class (complex calculation)
getAc()

// Initiative modifier
getInitiativeMod()

// Spell save DC for a class
getSpellSaveDc(className)

// Spell attack bonus for a class
getSpellAttackBonus(className)

// Passive scores
getPassivePerception()
getPassiveInvestigation()
getPassiveInsight()
```

#### Feature Calculations

The most important method for class mechanics:

```javascript
getFeatureCalculations() {
    // Returns object with all computed class features:
    // - Barbarian: rageDamage, ragesPerDay, brutalCritical
    // - Monk: martialArtsDie, kiPoints, kiSaveDc
    // - Fighter: superiorityDice, secondWindHealing
    // ... etc for all classes
}
```

#### Active States

```javascript
// Add a new active state
addActiveState(stateTypeId, options)

// Remove/deactivate
removeActiveState(stateId)
deactivateStatesByType(stateTypeId)

// Query
isStateTypeActive(stateTypeId)
getActiveStates()
getActiveStateEffects()
```

### Static Utility Methods

```javascript
// Parse feature text for limited uses
static parseFeatureUses(text, getAbilityMod, getProfBonus)

// Parse effects from description
static parseEffectsFromDescription(description)

// Detect if feature is activatable
static detectActivatableFeature(feature)

// Analyze toggle-ability
static analyzeToggleability(text)

// Summarize effects for display
static summarizeEffects(effects)
```

---

## CharacterSheetBuilder

**File**: `js/charactersheet/charactersheet-builder.js`  
**Lines**: ~5,783  
**Role**: Character Creation Wizard

### Wizard Steps

| Step | Content |
|------|---------|
| 1 | Race/Species selection |
| 2 | Class selection |
| 3 | Ability score assignment |
| 4 | Background selection |
| 5 | Skills, tools, languages |
| 6 | Review and finalize |

### Key State Properties

```javascript
this._currentStep = 1;
this._selectedRace = null;
this._selectedSubrace = null;
this._selectedClass = null;
this._selectedSubclass = null;
this._selectedBackground = null;
this._abilityMethod = "standard";  // "standard", "pointbuy", "manual"
this._abilityScores = {str: null, dex: null, con: null, int: null, wis: null, cha: null};
this._selectedSkills = [];
this._selectedExpertise = [];
this._useTashasRules = false;
```

### Key Methods

```javascript
show()           // Open the builder modal
_renderStep(n)   // Render step n content
_nextStep()      // Advance to next step
_prevStep()      // Go back to previous step
_finalize()      // Apply choices and create character
```

---

## CharacterSheetCombat

**File**: `js/charactersheet/charactersheet-combat.js`  
**Lines**: ~3,028  
**Role**: Combat Actions & Tracking

### Key Methods

```javascript
// Attacks
_showAttackCreator()
_addAttack(attackData)
_rollAttack(attackId, event)  // event for advantage/disadvantage keys
_rollDamage(attackId)

// Initiative
_rollInitiative(event)

// Death Saves
_rollDeathSave(isSuccess)
_resetDeathSaves()

// Conditions
_onAddCondition()
renderCombatConditions()

// Combat Methods (TGTT stamina system)
_useMethod(methodId)
_modifyStamina(delta)
```

### Attack Data Structure

```javascript
{
    id: "unique-id",
    name: "Longsword",
    attackBonus: 5,
    damage: "1d8+3",
    damageType: "slashing",
    properties: ["versatile"],
    range: "5 ft",
    notes: "",
}
```

---

## CharacterSheetSpells

**File**: `js/charactersheet/charactersheet-spells.js`  
**Lines**: ~2,661  
**Role**: Spellcasting Management

### Key Methods

```javascript
// Spell Slots
_toggleSlot(level, $pip)
_recoverSlots(level, amount)

// Spell Management
_showSpellPicker()
_addSpell(spell)
_removeSpell(spellId)
_togglePrepared(spellId)

// Casting
_castSpell(spellId)
_showCastingDialog(spell)

// Rendering
renderSpellSlots()
_renderSpellList()
```

### Spell Data Structure

```javascript
{
    id: "unique-id",
    name: "Fireball",
    level: 3,
    school: "evocation",
    castingTime: "1 action",
    range: "150 feet",
    components: {v: true, s: true, m: "a tiny ball of bat guano"},
    duration: "Instantaneous",
    description: "...",
    source: "PHB",
    classes: ["sorcerer", "wizard"],
    prepared: true,  // for prepared casters
    alwaysPrepared: false,  // domain spells, etc.
}
```

---

## CharacterSheetInventory

**File**: `js/charactersheet/charactersheet-inventory.js`  
**Lines**: ~2,008  
**Role**: Items & Equipment

### Key Methods

```javascript
// Items
_showItemPicker()
_addItem(item)
_removeItem(itemId)
_changeQuantity(itemId, delta)

// Equipment
_toggleEquipped(itemId)
_toggleAttuned(itemId)

// Charges
_useCharge(itemId)
_restoreCharge(itemId)

// Currency
_updateCurrency(type, value)

// Encumbrance
_calculateEncumbrance()
```

### Item Data Structure

```javascript
{
    id: "unique-id",
    name: "Plate Armor",
    type: "armor",
    weight: 65,
    value: "1500 gp",
    quantity: 1,
    equipped: true,
    attuned: false,
    charges: {current: 0, max: 0},
    properties: [],
    ac: 18,
    notes: "",
    appliedUpgrades: [],     // [{name, source, upgradeType, entries, tier, costPaid}]
    socketedGemstones: [],   // [{name, source, gemName, entries, charges: {current, max}}]
}
```

---

## CharacterSheetFeatures

**File**: `js/charactersheet/charactersheet-features.js`  
**Lines**: ~1,585  
**Role**: Feature Display & Tracking

### Key Methods

```javascript
// Feats
_showFeatPicker()
_addFeat(feat)
_removeFeat(featId)

// Features
_renderFeatures()
_getFeatureDescription(feature)
_toggleFeatureExpand(featureId)

// Feature Uses
_useFeature(featureId)
_recoverFeatureUses(featureId)
```

---

## CharacterSheetRest

**File**: `js/charactersheet/charactersheet-rest.js`  
**Lines**: ~391  
**Role**: Rest Mechanics

### Key Methods

```javascript
// Short Rest
_showShortRestDialog()
_performShortRest(hitDiceSpent)

// Long Rest
_showLongRestDialog()
_performLongRest()
```

### Short Rest Effects

1. Spend hit dice to heal
2. Recover certain class features
3. Recover Warlock pact slots

### Long Rest Effects

1. Regain all HP
2. Recover hit dice (up to half total)
3. Recover all spell slots
4. Recover all class features
5. Reset death saves

---

## CharacterSheetLevelUp

**File**: `js/charactersheet/charactersheet-levelup.js`  
**Lines**: ~3,628  
**Role**: Level Progression

### Key Methods

```javascript
// Main flow
showLevelUpDialog(className)
_applyLevelUp(choices)

// Feature options
_findFeatureOptions(feature, characterLevel)
_renderFeatureChoices(features)

// ASI/Feats
_renderASIChoice()
_applyASI(choices)
```

### Level Up Choices

- Class features automatically applied
- Subclass selection (at appropriate level)
- Ability Score Improvement or Feat
- Optional feature choices (invocations, maneuvers)
- Spell selection for casters

---

## CharacterSheetExport

**File**: `js/charactersheet/charactersheet-export.js`  
**Lines**: ~322  
**Role**: Import/Export

### Export Formats

1. **JSON**: Full character data for backup/transfer
2. **Print/PDF**: Browser print dialog

### Key Methods

```javascript
_showExportDialog()
_exportJson()
_showImportDialog()
_importJson(jsonStr)
_printCharacter()
```

---

## CharacterSheetLayout

**File**: `js/charactersheet/charactersheet-layout.js`  
**Lines**: ~618  
**Role**: UI Customization

### Features

- Drag-and-drop section reordering
- Per-character layout persistence
- Reset to default layout
- Edit mode toggle

### Key Methods

```javascript
_initDragDrop(container)
_saveLayoutForTab(tabId)
_loadLayoutForTab(tabId)
_resetLayout()
toggleEditMode()
```

---

## CharacterSheetUpgrades

**File**: `js/charactersheet/charactersheet-upgrades.js`  
**Lines**: ~560  
**Role**: Item Upgrades, Gemstone Empowerment & Socketing

### Features

- Upgrade picker modal: browse eligible upgrades by tier, show prerequisites and costs
- **Rules-reference hover header** in the picker — links the governing TCAH variant rule (Upgrading Armor for armor/shields, Weapon Upgrade Comparison for weapons) so players can hover for the source text.
- Gold deduction with multi-denomination conversion
- **Refund-on-remove flow**: removing an applied upgrade prompts for No / Full / Half refund of the originally paid cost via `state.addGold()`.
- Gemstone empowerment modal: crafting roll (proficiency + CHA/WIS vs DC)
- Gemstone socketing: socket/unsocket with 1-gem-per-item limit
- Mechanical effect calculation from applied upgrades
- Upgrade badges on item rows

### Key Methods

```javascript
// Modals
showUpgradePickerModal(itemId)
showEmpowermentModal()
showGemstoneSocketModal(itemId)

// Type detection (static)
static isWeapon(item)
static isArmor(item)
static isShield(item)
static isSocketable(item)

// Effects (static)
static getUpgradeEffects(item)      // {bonusWeaponAttack, bonusWeaponDamage, critThresholdReduction, ...}
static getGemstoneEffects(item)     // [{name, entries, charges, ...}]
static increaseDamageDie(die, steps) // "1d6" -> "1d8"

// Cost helpers (static) — accept legacy string OR structured {gp, isBase?, note?}
static parseGoldCost(cost)          // "1,000 gp (base)" or {gp:1000, isBase:true} -> 1000
static formatCostDisplay(cost)      // -> "1,000 gp (base)"
static isBaseCost(cost)             // true if cost is a per-upgrade base cost (DM may scale)

// Rules reference (static)
static getRulesReference(item)      // -> {name, source, label} | null
```

### State Methods (on CharacterSheetState)

```javascript
applyItemUpgrade(itemId, upgrade, costPaid)
removeItemUpgrade(itemId, name, source)
getItemUpgrades(itemId)
hasItemUpgrade(itemId, name)
getItemWeaponUpgradeTier(itemId)
socketGemstone(itemId, gemstone)
unsocketGemstone(itemId, name)
getSocketedGemstones(itemId)
useGemstoneCharge(itemId, name)
restoreGemstoneCharges(itemId, name, amount)
rechargeAllGemstones()
getUpgradedItems()
deductGold(gpCost)
addGold(gpAmount)                   // refunds, accepts fractional amounts
getEffectiveItemBonuses(itemId)
```

### Data Schema

`itemUpgrade` entities are validated by [`schema/site/itemupgrades.json`](https://github.com/5etools-mirror-3/5etools-utils/blob/master/schema/site/itemupgrades.json) and [`schema/brew/itemupgrades.json`](https://github.com/5etools-mirror-3/5etools-utils/blob/master/schema/brew/itemupgrades.json). The `cost` field accepts either a legacy string (e.g. `"100 gp (base)"`) or a structured object `{gp: number, isBase?: boolean, note?: string}`. Site data restricts `upgradeType` to `WU`, `WU:1`, `WU:2`, `WU:3`, `AU`; brew may declare additional codes (e.g. `GS:C`) via `_meta.itemUpgradeTypes`.

---

## Favorites System

**Files**: state in `charactersheet-state.js` (~L22198–22365), UI in `charactersheet.js` (~L5837–6160, Actions hub).

Lightweight cross-tab "star this thing" surface. Any feature/spell/attack/item/resource/ability can be favourited and surfaces in the Actions hub favourites strip.

### State Shape

```javascript
_data.favorites = [
    {
        id: "feature:Rage",      // "type:idSuffix" — stable across renders
        type: "feature",          // feature | spell | attack | item | resource | ability
        name: "Rage",             // Display name (may be re-resolved on load)
        meta: { ... },             // Optional payload (spell level, attack id, …)
    },
];
```

### Public API

| Method | Purpose |
|---|---|
| `isFavorite(type, idSuffix)` | Cheap membership check (used by star icons) |
| `addFavorite(favData, {max = 8})` | Adds; returns `true` if added, `false` if at cap |
| `removeFavorite(id)` | Removes by full `id`; returns `true` if removed |
| `toggleFavorite(favData, {max = 8})` | Returns `"added"`, `"removed"`, or `null` (cap hit) |
| `_resolveFavorite(fav)` | Re-resolves the entity (handles renames, source migrations) — returns `{found, entity, …}` |
| `isFavoriteResolved(fav)` | Bool wrapper around `_resolveFavorite` |
| `getOrphanedFavorites()` | Returns favourites whose source entity no longer exists |
| `cleanupOrphanedFavorites()` | Removes orphans in-place; returns removed count |

### Invariants

- **Cap = 8 favourites** by default (configurable per call).
- **Stable IDs**: `id` is the canonical key. `name` may drift; resolution falls back to the entity lookup.
- **Orphan handling is opt-in**: the page surfaces a "Remove N orphans" toast button rather than auto-pruning, to protect against transient data-load failures.
- **Items use a parallel legacy favourites system** (item starring predates this one) — `_data.favorites` does not duplicate it.

---

## Apply Buff Modal

**Files**: button in `charactersheet.js` (~L6411, Active States section), helpers in `js/charactersheet/charactersheet-buffpicker-helpers.js`.

A modal for **non-casters** (and anyone tracking party buffs) to apply a buff spell cast on them — Aid, Bless, Haste, Mage Armor, etc. — without having to know spellcasting mechanics. Activated via the **"Apply Buff"** button in the Active States section.

### Helper Module (`charactersheet-buffpicker-helpers.js`)

Pure helpers, ~170 lines, no DOM dependencies — safe to unit-test.

| Export | Purpose |
|---|---|
| `BUFF_CATEGORY_ORDER` | Display order: `["defense", "offense", "healing", "movement", "utility"]` |
| `BUFF_CATEGORY_META` | Per-category `{label, icon, colorClass}` |
| `categoriseBuffEntry(spec)` | Classifies a buff spec into one of the 5 categories |
| `buildBuffEffectChip(eff)` | Renders one effect as a compact chip (e.g. `+1 AC`, `+1d4 attack`) |
| `getBuffEffectChips(spec)` | Flattens a buff spec into an array of chip descriptors |
| `formatBuffDuration(duration, concentration)` | Human-readable duration string |
| `isBuffSpellActive(displayName, activeStates)` | True if the buff is already in `_data.activeStates` |

### Behaviour

- Buff specs come from the spell registry (`_parseBuffs`) — same source the casting flow uses, so a buff applied via this modal matches one cast normally.
- Concentration buffs respect the existing concentration cascade (taking a new one drops the old).
- Already-active buffs are shown disabled with a "Currently active" badge.

---

## Lore Skills (TGTT)

Rendered inline in the **Skills** tab via `_renderLoreSkillsSection()` (charactersheet.js ~L2849). See [TGTT Homebrew → Lore Skills](./13-tgtt-thelemar-homebrew.md#lore-skills) for the rule and state methods.

---

*Previous: [Architecture](./02-architecture.md) | Next: [State Management](./04-state-management.md)*
