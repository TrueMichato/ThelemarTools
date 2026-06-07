# Spellcasting System

This document details the spellcasting management system in the character sheet.

## Overview

The `CharacterSheetSpells` module handles all spellcasting functionality:
- Spell slot tracking
- Per-class spell & cantrip tracking (multiclass-aware; see below)
- Pact magic (Warlock)
- Spell casting and concentration
- Ritual casting

**File**: `js/charactersheet/charactersheet-spells.js`  
**Lines**: ~2,661

---

## Core Class

### CharacterSheetSpells

```javascript
class CharacterSheetSpells {
    constructor(page) {
        this._page = page;
        this._state = page.getState();
        this._allSpells = [];          // All 5etools spells
        this._filteredSpells = [];     // Spells available to character
        this._spellFilter = "";        // Search filter
        this._spellLevelFilter = "all"; // Level filter
    }
}
```

---

## Spell Slots

### Data Structure

```javascript
// In CharacterSheetState._data
spellSlots: {
    1: {max: 4, current: 2},   // 1st level: 4 max, 2 remaining
    2: {max: 3, current: 3},   // 2nd level: 3 max, all remaining
    3: {max: 2, current: 0},   // 3rd level: 2 max, none remaining
    // ...
}
```

### Slot Progression

The state calculates max slots based on class levels:

```javascript
// Full casters (Bard, Cleric, Druid, Sorcerer, Wizard)
// Use full level for slot progression
const FULL_CASTER_SLOTS = {
    1: {1: 2},
    2: {1: 3},
    3: {1: 4, 2: 2},
    4: {1: 4, 2: 3},
    5: {1: 4, 2: 3, 3: 2},
    // ...up to level 20
};

// Half casters (Paladin, Ranger, Artificer)
// Use half level, rounded down, minimum 1 for spells at level 2+

// Third casters (Eldritch Knight, Arcane Trickster)
// Use level / 3, rounded up
```

### Multiclass Slot Calculation

```javascript
_calculateMulticlassSlots() {
    const classes = this._state.getClasses();
    let totalCasterLevel = 0;
    
    classes.forEach(cls => {
        const level = cls.level;
        const className = cls.name;
        const subclassName = cls.subclass?.name;
        
        // Full casters
        if (["Bard", "Cleric", "Druid", "Sorcerer", "Wizard"].includes(className)) {
            totalCasterLevel += level;
        }
        // Half casters (round down)
        else if (["Paladin", "Ranger"].includes(className) && level >= 2) {
            totalCasterLevel += Math.floor(level / 2);
        }
        // Third casters (round up)
        else if (["Eldritch Knight", "Arcane Trickster"].includes(subclassName) && level >= 3) {
            totalCasterLevel += Math.ceil(level / 3);
        }
        // Artificer (round up, half caster)
        else if (className === "Artificer") {
            totalCasterLevel += Math.ceil(level / 2);
        }
    });
    
    // Look up slots from multiclass table
    return MULTICLASS_SPELL_SLOTS[totalCasterLevel] || {};
}
```

### Slot UI

The UI displays slots as clickable pips:

```javascript
_renderSpellSlots() {
    const $container = $("#charsheet-spell-slots");
    $container.empty();
    
    for (let level = 1; level <= 9; level++) {
        const max = this._state.getSpellSlotsMax(level);
        if (max <= 0) continue;
        
        const current = this._state.getSpellSlotsCurrent(level);
        
        const $row = $(`<div class="charsheet__slot-row" data-spell-level="${level}">
            <span class="charsheet__slot-label">${level}${Parser.numberToSuperscript(level)} Level</span>
            <div class="charsheet__slot-pips"></div>
        </div>`);
        
        const $pips = $row.find(".charsheet__slot-pips");
        for (let i = 0; i < max; i++) {
            const isUsed = i >= current;
            $pips.append(`<span class="charsheet__slot-pip ${isUsed ? "used" : ""}"></span>`);
        }
        
        $container.append($row);
    }
}
```

### Toggling Slots

```javascript
_toggleSlot(level, $pip) {
    const isUsed = $pip.hasClass("used");
    
    if (isUsed) {
        // Restore slot (clicked on used pip)
        const newCurrent = this._state.getSpellSlotsCurrent(level) + 1;
        this._state.setSpellSlotsCurrent(level, newCurrent);
    } else {
        // Use slot (clicked on available pip)
        const newCurrent = this._state.getSpellSlotsCurrent(level) - 1;
        this._state.setSpellSlotsCurrent(level, newCurrent);
    }
    
    this._renderSpellSlots();
    this._page.saveCharacter();
}
```

---

## Pact Magic (Warlock)

Warlocks use separate "pact slots" that work differently from standard slots.

### Data Structure

```javascript
pactSlots: {
    level: 3,      // Pact slot spell level (scales with warlock level)
    max: 2,        // Number of pact slots
    current: 1,    // Currently available
}
```

### Pact Slot Progression

```javascript
// Warlock pact magic progression
const PACT_MAGIC_PROGRESSION = {
    1:  {slots: 1, level: 1},
    2:  {slots: 2, level: 1},
    3:  {slots: 2, level: 2},
    4:  {slots: 2, level: 2},
    5:  {slots: 2, level: 3},
    6:  {slots: 2, level: 3},
    7:  {slots: 2, level: 4},
    8:  {slots: 2, level: 4},
    9:  {slots: 2, level: 5},
    10: {slots: 2, level: 5},
    11: {slots: 3, level: 5},
    12: {slots: 3, level: 5},
    // ...
    17: {slots: 4, level: 5},
    // ...
};
```

### Rendering Pact Slots

```javascript
_renderPactSlots() {
    const warlockLevel = this._state.getClassLevel("Warlock");
    if (!warlockLevel) return;
    
    const pactInfo = PACT_MAGIC_PROGRESSION[warlockLevel];
    const current = this._state.getPactSlotsCurrent();
    
    // Display pact slots separately from regular slots
    const $container = $("#charsheet-pact-slots");
    $container.html(`
        <div class="charsheet__pact-header">
            Pact Slots (${pactInfo.level}${Parser.numberToSuperscript(pactInfo.level)} Level)
        </div>
        <div class="charsheet__pact-pips">
            ${this._renderSlotPips(pactInfo.slots, current, "pact")}
        </div>
    `);
}
```

---

## Spell Management

### Adding Spells

The spell picker shows spells available to the character's class:

```javascript
async _showSpellPicker() {
    const classes = this._state.getClasses();
    const primaryClass = classes[0];
    
    // Filter spells by class spell list
    const classSpells = this._filterSpellsByClass(primaryClass);
    
    // Filter by max spell level the character can cast
    const maxLevel = this._getMaxSpellLevel(primaryClass);
    const availableSpells = classSpells.filter(s => s.level <= maxLevel);
    
    // Show picker modal
    await this._pShowSpellPickerModal(availableSpells);
}

_filterSpellsByClass(classInfo) {
    return this._allSpells.filter(spell => {
        const fromClassList = Renderer.spell.getCombinedClasses(spell, "fromClassList");
        return fromClassList?.some(c => 
            c.name.toLowerCase() === classInfo.name.toLowerCase()
        );
    });
}
```

### Max Spell Level Calculation

```javascript
_getMaxSpellLevel(classInfo, characterLevel) {
    const className = classInfo.name;
    const subclassName = classInfo.subclass?.name;
    
    // Warlock: Pact slots max at 5th, but Mystic Arcanum grants higher
    if (className === "Warlock") {
        if (characterLevel >= 17) return 9;
        if (characterLevel >= 15) return 8;
        if (characterLevel >= 13) return 7;
        if (characterLevel >= 11) return 6;
        return Math.min(5, Math.ceil(characterLevel / 2));
    }
    
    // Full casters: (level + 1) / 2, max 9
    if (["Bard", "Cleric", "Druid", "Sorcerer", "Wizard"].includes(className)) {
        return Math.min(9, Math.ceil(characterLevel / 2));
    }
    
    // Half casters: level / 4 + 1, start at level 2
    if (["Paladin", "Ranger", "Artificer"].includes(className)) {
        if (characterLevel < 2) return 0;
        return Math.min(5, Math.floor((characterLevel + 1) / 4) + 1);
    }
    
    // Third casters: level / 6 + 1, start at level 3
    if (["Eldritch Knight", "Arcane Trickster"].includes(subclassName)) {
        if (characterLevel < 3) return 0;
        return Math.min(4, Math.floor((characterLevel - 1) / 6) + 1);
    }
    
    return 0;
}
```

### Spell Data Structure

```javascript
// Known spell entry
{
    id: "spell-1234",
    name: "Fireball",
    level: 3,
    school: "evocation",
    source: "PHB",
    prepared: true,          // For prepared casters
    alwaysPrepared: false,   // Domain spells, etc.
    isRitual: false,
    concentration: false,
    castingTime: "1 action",
    range: "150 feet",
    components: {v: true, s: true, m: "a tiny ball of bat guano"},
    duration: "Instantaneous",
    data: { /* full 5etools spell data */ },
}
```

### Prepared Spells

For prepared casters (Cleric, Druid, Paladin, Wizard):

```javascript
_togglePrepared(spellId) {
    const spell = this._state.getKnownSpell(spellId);
    if (!spell) return;
    
    // Can't unprepare always-prepared spells
    if (spell.alwaysPrepared) {
        JqueryUtil.doToast({
            type: "info",
            content: `${spell.name} is always prepared and cannot be unprepared.`,
        });
        return;
    }
    
    // Check preparation limit
    if (!spell.prepared) {
        const preparedCount = this._state.getPreparedSpellCount();
        const maxPrepared = this._getMaxPreparedSpells();
        
        if (preparedCount >= maxPrepared) {
            JqueryUtil.doToast({
                type: "warning",
                content: `You can only prepare ${maxPrepared} spells. Unprepare another spell first.`,
            });
            return;
        }
    }
    
    this._state.toggleSpellPrepared(spellId);
    this._renderSpellList();
    this._page.saveCharacter();
}

_getMaxPreparedSpells() {
    const classes = this._state.getClasses();
    const primaryClass = classes[0];
    const level = primaryClass.level;
    
    // Wizard: INT + wizard level
    if (primaryClass.name === "Wizard") {
        return Math.max(1, this._state.getAbilityMod("int") + level);
    }
    
    // Cleric, Druid: WIS + class level
    if (["Cleric", "Druid"].includes(primaryClass.name)) {
        return Math.max(1, this._state.getAbilityMod("wis") + level);
    }
    
    // Paladin: CHA + half paladin level
    if (primaryClass.name === "Paladin") {
        return Math.max(1, this._state.getAbilityMod("cha") + Math.floor(level / 2));
    }
    
    return Infinity; // Known casters don't have a limit
}
```

---

## Per-Class Spell Tracking (Multiclass)

The Spells-tab header and per-spell cast routing are **per spellcasting class**,
not collapsed into a single aggregate. This is the source of truth for what the
player sees as counts, save DC, and spell attack.

### `getSpellcastingClassBreakdown()` (state)

Returns one card object per caster class (including subclass casters — Eldritch
Knight, Arcane Trickster, Gambler, Architect of Ruin):

```javascript
{
  className, classSource, subclassName,
  displayName,        // subclass name for subclass-derived casters, else class name
  ability, abilityLabel,
  saveDc, attackBonus, // per-class (uses this class's spellcasting ability)
  mechanic,           // "known" | "prepared" | "spellbook" | "rolled"
  is2024, isRolledPrepared, preparedDice,
  spellsCount, spellsMax, spellsGranted,     // player-chosen vs cap; +granted feature spells
  cantripsCount, cantripsMax, cantripsGranted,
  matchKeys,          // lowercased class/subclass keys (incl. "gambler") for attribution
}
```

Attribution: a spell/cantrip belongs to a card when its `sourceClass` **or**
`sourceSubclass` is in that card's `matchKeys`. Player-chosen vs feature-granted
is split by `isPlayerChosenSpell` — granted spells (subclass always-prepared like
Zodiac's Guiding Bolt, the Magician bonus cantrip) are reported as `+N granted`
and excluded from the count. Wizard spellbook classes (`mechanic === "spellbook"`)
show a capless count. Anything matching no card is summed by
`getUnattributedSpellCounts()` into an **"Other / Unattributed"** card so legacy
or mis-stamped data is never lost.

### Per-class ability / DC / attack

- `getSpellcastingAbilityForClass(cls)` — EK/AT→`int`, Gambler/Architect→`cha`,
  else `cls.spellcastingAbility`, else a static class→ability map.
- `getSpellcastingAbilityForSpell(spell)` — resolves a spell's casting ability
  from its `sourceClass`/`sourceSubclass` (fallback to the global ability).
- `getSpellSaveDcForAbility(ability)` / `getSpellAttackBonusForAbility(ability)` —
  the no-arg `getSpellSaveDc()` / `getSpellAttackBonus()` delegate to these with
  the global ability (values unchanged for back-compat). DC includes item/custom
  + exhaustion; attack is exhaustion-free (penalty applied once at roll time).

Each class has its **own** save DC and spell attack; they coincide only when the
classes share a spellcasting ability with no special modifiers. The Combat tab
and Overview quick-spell headers show the shared value when all classes agree,
otherwise **"Varies"** with a per-class tooltip.

### UI (Spells tab)

`_renderSpellTrackingUI()` renders one card per breakdown entry into
`#charsheet-spellcasting-stats` (replacing the old single-ability header + four
fixed known/prepared/cantrip boxes). Each card shows Ability • Save DC • Spell
Attack and clickable **Spells**/**Cantrips** chips (`current/max`, `+N granted`,
over-limit colouring). There are **no** "known"/"prepared" labels or 2014/2024
badges in the UI — the mechanic is retained in the backend (and a subtle
tooltip) for enforcement only. Clicking a chip opens a class-scoped Add-Spell
modal; `targetClass` is threaded `_showSpellPicker → _pShowSpellPickerModal →
_addSpell → pickAddedSpellAttribution` so the new spell is stamped with the
correct `sourceClass`/`sourceFeature`. The primary card keeps the legacy
`#charsheet-spell-ability/-dc/-attack` ids; all cards carry the
`.charsheet__spell-ability/-dc/-attack` classes.

### Cast-time routing

`_castSpell`, `_applySpellEffectsToSelf`, and `_rollSpellHealing` route the
casting modifier per spell via `getSpellcastingAbilityForSpell(spell)`; the
static `calculateSpellHealing(spell, slotLevel, caster, abilityOverride)` takes
an optional `abilityOverride`. Gambler is a per-spell mode keyed on
`spell.sourceClass/sourceSubclass === "Gambler"`, and `_togglePrepared` enforces
the Gambler rolled cap on Gambler-attributed spells (so it works in multiclass).

---

## Casting Spells

### Basic Casting

```javascript
async _castSpell(spellId) {
    const spell = this._state.getKnownSpell(spellId);
    if (!spell) return;
    
    // Cantrips don't require slots
    if (spell.level === 0) {
        this._displaySpellCast(spell);
        return;
    }
    
    // Check available slots
    const availableSlots = this._getAvailableSlots(spell.level);
    if (availableSlots.length === 0) {
        JqueryUtil.doToast({
            type: "warning",
            content: `No spell slots available to cast ${spell.name}.`,
        });
        return;
    }
    
    // If multiple slot levels available, show picker
    if (availableSlots.length > 1) {
        await this._showSlotPicker(spell, availableSlots);
    } else {
        this._castAtLevel(spell, availableSlots[0]);
    }
}
```

### Upcasting

```javascript
async _showSlotPicker(spell, availableSlots) {
    const {$modalInner, doClose} = await UiUtil.pGetShowModal({
        title: `Cast ${spell.name}`,
    });
    
    $modalInner.append(`<p>Choose a spell slot level:</p>`);
    
    availableSlots.forEach(slotLevel => {
        const isPact = slotLevel.isPact;
        const label = isPact ? `Pact Slot (${slotLevel.level}th)` : `${slotLevel.level}${Parser.numberToSuperscript(slotLevel.level)} Level`;
        
        $(`<button class="btn btn-default btn-sm">${label}</button>`)
            .click(() => {
                this._castAtLevel(spell, slotLevel);
                doClose();
            })
            .appendTo($modalInner);
    });
}

_castAtLevel(spell, slotInfo) {
    // Consume the slot
    if (slotInfo.isPact) {
        this._state.consumePactSlot();
    } else {
        this._state.consumeSpellSlot(slotInfo.level);
    }
    
    // Handle concentration
    if (spell.concentration) {
        this._startConcentration(spell);
    }
    
    // Display cast message
    this._displaySpellCast(spell, slotInfo.level);
    
    // Update UI
    this._renderSpellSlots();
    this._page.saveCharacter();
}
```

---

## Concentration

### Tracking Concentration

```javascript
// In CharacterSheetState._data
concentration: {
    spellName: "Bless",
    spellId: "spell-1234",
    startTime: 1234567890,
    durationMinutes: 10,
}
```

### Starting Concentration

```javascript
_startConcentration(spell) {
    // Check if already concentrating
    const current = this._state.getConcentration();
    if (current) {
        // Confirm break concentration
        if (!confirm(`You are concentrating on ${current.spellName}. Break concentration to cast ${spell.name}?`)) {
            return false;
        }
        this._breakConcentration();
    }
    
    // Parse duration
    const durationMinutes = this._parseDuration(spell.duration);
    
    this._state.setConcentration({
        spellName: spell.name,
        spellId: spell.id,
        startTime: Date.now(),
        durationMinutes,
    });
    
    return true;
}

_parseDuration(durationStr) {
    // "Concentration, up to 1 minute" -> 1
    // "Concentration, up to 10 minutes" -> 10
    // "Concentration, up to 1 hour" -> 60
    const match = durationStr.match(/up to (\d+) (minute|hour)/i);
    if (!match) return 10; // Default
    
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    
    return unit === "hour" ? value * 60 : value;
}
```

### Concentration Checks

```javascript
_rollConcentrationCheck(damage) {
    const dc = Math.max(10, Math.floor(damage / 2));
    const mod = this._state.getSavingThrowMod("con");
    
    // Check for War Caster
    const hasWarCaster = this._state.hasFeat("War Caster");
    
    // Check for Bladesong
    const calc = this._state.getFeatureCalculations();
    let bonus = 0;
    if (calc.bladesongConcentrationBonus && this._state.isStateTypeActive("bladesong")) {
        bonus = calc.bladesongConcentrationBonus;
    }
    
    const roll = Renderer.dice.randomNumber(1, 20);
    const total = roll + mod + bonus;
    
    if (total >= dc) {
        JqueryUtil.doToast({
            type: "success",
            content: `Concentration maintained! (${roll} + ${mod + bonus} = ${total} vs DC ${dc})`,
        });
        return true;
    } else {
        this._breakConcentration();
        JqueryUtil.doToast({
            type: "danger",
            content: `Concentration broken! (${roll} + ${mod + bonus} = ${total} vs DC ${dc})`,
        });
        return false;
    }
}
```

---

## Ritual Casting

```javascript
_canRitualCast(spell) {
    if (!spell.isRitual) return false;
    
    const classes = this._state.getClasses();
    
    // Wizard: Can ritual cast from spellbook (even unprepared)
    if (classes.some(c => c.name === "Wizard")) {
        return true;
    }
    
    // Cleric, Druid: Must have prepared
    if (classes.some(c => ["Cleric", "Druid"].includes(c.name))) {
        return spell.prepared || spell.alwaysPrepared;
    }
    
    // Bard: Must know the spell
    if (classes.some(c => c.name === "Bard")) {
        return true; // If they have it, they know it
    }
    
    // Ritual Caster feat
    if (this._state.hasFeat("Ritual Caster")) {
        return true; // Assuming they added it to their ritual book
    }
    
    return false;
}

_castAsRitual(spell) {
    // Rituals take 10 minutes longer but don't use a slot
    JqueryUtil.doToast({
        type: "info",
        content: `Casting ${spell.name} as a ritual (10 minutes).`,
    });
    
    // Handle concentration if applicable
    if (spell.concentration) {
        this._startConcentration(spell);
    }
    
    this._displaySpellCast(spell, null, true);
}
```

---

## Spell Display

### Spell List Rendering

```javascript
_renderSpellList() {
    const $container = $("#charsheet-spell-list");
    $container.empty();
    
    const knownSpells = this._state.getKnownSpells();
    
    // Apply filters
    let filteredSpells = knownSpells;
    if (this._spellFilter) {
        filteredSpells = filteredSpells.filter(s => 
            s.name.toLowerCase().includes(this._spellFilter)
        );
    }
    if (this._spellLevelFilter !== "all") {
        filteredSpells = filteredSpells.filter(s => 
            s.level === parseInt(this._spellLevelFilter)
        );
    }
    
    // Group by level
    const byLevel = this._groupByLevel(filteredSpells);
    
    // Render each level group
    Object.entries(byLevel)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .forEach(([level, spells]) => {
            this._renderSpellLevelGroup(level, spells, $container);
        });
}

_renderSpellLevelGroup(level, spells, $container) {
    const levelName = level === "0" ? "Cantrips" : `${level}${Parser.numberToSuperscript(level)} Level`;
    
    const $group = $(`
        <div class="charsheet__spell-group">
            <div class="charsheet__spell-group-header">${levelName}</div>
        </div>
    `);
    
    spells.forEach(spell => {
        $group.append(this._renderSpellItem(spell));
    });
    
    $container.append($group);
}
```

### Individual Spell Item

```javascript
_renderSpellItem(spell) {
    const isPrepared = spell.prepared || spell.alwaysPrepared;
    const isConcentration = spell.concentration;
    const isRitual = spell.isRitual;
    
    return $(`
        <div class="charsheet__spell-item ${isPrepared ? "" : "charsheet__spell-item--unprepared"}" data-spell-id="${spell.id}">
            <span class="charsheet__spell-name">
                ${spell.name}
                ${isConcentration ? '<span class="charsheet__spell-tag" title="Concentration">C</span>' : ""}
                ${isRitual ? '<span class="charsheet__spell-tag" title="Ritual">R</span>' : ""}
            </span>
            <span class="charsheet__spell-school">${spell.school}</span>
            <div class="charsheet__spell-actions">
                ${spell.level > 0 ? '<button class="charsheet__spell-cast btn btn-xs btn-primary" title="Cast">🎯</button>' : ""}
                <button class="charsheet__spell-info btn btn-xs btn-default" title="Info">ℹ️</button>
                ${!spell.alwaysPrepared ? '<button class="charsheet__spell-prepared btn btn-xs btn-default" title="Toggle Prepared">📖</button>' : ""}
                <button class="charsheet__spell-remove btn btn-xs btn-danger" title="Remove">✕</button>
            </div>
        </div>
    `);
}
```

---

## Integration Points

### With CharacterSheetState

```javascript
// Spell slots
this._state.getSpellSlotsMax(level);
this._state.getSpellSlotsCurrent(level);
this._state.setSpellSlotsCurrent(level, current);

// Pact slots
this._state.getPactSlotLevel();
this._state.getPactSlotsMax();
this._state.getPactSlotsCurrent();

// Known/prepared spells
this._state.getKnownSpells();
this._state.addKnownSpell(spell);
this._state.removeKnownSpell(spellId);
this._state.toggleSpellPrepared(spellId);

// Concentration
this._state.getConcentration();
this._state.setConcentration(info);
this._state.clearConcentration();
```

### With Combat Module

```javascript
// Combat tab shows quick-cast for combat spells
this._page._combat.renderCombatSpells();

// Concentration tracking in combat
this._page._combat.renderCombatStates();
```

---

## Apply Buff Modal (Non-Caster Buff Tracking)

The **"Apply Buff"** button in the Active States section (charactersheet.js ~L6411) opens a modal that lets non-casters — or anyone tracking buffs cast on them by the party — apply a buff spell directly, without going through the casting flow.

### Why it exists

A Barbarian whose Cleric just cast Bless still needs the +1d4 to attacks/saves tracked. Before this modal, the only way was for the caster to cast it via the character sheet, which doesn't work cross-character.

### Helper module — `charactersheet-buffpicker-helpers.js`

Pure helpers, no DOM. Categorise buffs into `defense / offense / healing / movement / utility`, render effect chips, format durations, detect already-active buffs. See [Components Reference → Apply Buff Modal](./03-components-reference.md#apply-buff-modal) for the full export list.

### Pipeline

1. Spell registry is parsed via `_parseBuffs` — **same source** the regular casting flow uses, so an applied buff is mechanically identical to a cast buff.
2. The modal groups buffs by category and renders chips for each effect.
3. Selecting a buff routes through `_applyBuffEffects()` in `charactersheet-spells.js` (~L4318), which:
   - Prefers `registryEffects` when available (more reliable)
   - Falls back to parsed `buffs` array entries
   - Respects the standard concentration cascade (taking a new concentration buff drops the previous one)
   - Skips buffs that are already active (badge "Currently active" shown in the picker)

### Buff effect → state effect mapping

The parser-to-effect mapping in `charactersheet-spells.js` (`_applyBuffEffects`, ~L4444) handles: `rollBonus`, `rollPenalty`, `extraDamage`, `resistance`, `advantage`, `formula` (set AC), `minimum` (min AC), `multiplier`/`bonus` for speed, plus generic `bonus` fallback.

### Buff dice on d20 rolls (`rollBonus` / `rollPenalty`)

`rollBonus` / `rollPenalty` effects carry a **die** (e.g. Bless `1d4`, Gift of Alacrity `1d8`), not a flat number, so they can't be folded into the canonical stat. They are surfaced generically by `CharacterSheetState.getRollBonusDiceFromStates(rollType)`, which returns `[{dice, sign, source}]` using the same hierarchical target matching as `hasAdvantageFromStates` (`initiative`, `attack[:melee:str]`, `save[:dex]`, `check[:str]`).

Every d20 roll handler (`_rollAbilityCheck`, `_rollSavingThrow`, `_rollSkillCheck`, `_rollAttack`, `_rollInitiative` in both `charactersheet.js` and `charactersheet-combat.js`) calls the page helper `_rollStateDiceBonuses(rollType)`, which rolls each die and folds the result into the roll total plus a breakdown line (e.g. `+ 6 [1d8 Gift of Alacrity]`). The initiative stat breakdown popover (`getInitiativeBreakdown().diceBonuses` → `_renderStatBreakdown`) shows the die as a `+1d8` chip while leaving the canonical/effective numbers unchanged. A generic `check`/`save`/`attack` target matches any specific roll of that family; an `initiative` target matches only the initiative roll.

---

*Previous: [Combat System](./06-combat-system.md) | Next: [Toggle Abilities](./08-toggle-abilities.md)*
