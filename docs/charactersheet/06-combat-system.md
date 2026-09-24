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

### Feature-Granted Attacks

`renderAttacks()` also merges `state.getFeatureGrantedAttacks()` into the
canonical attack list. These descriptors come from feature calculations and
are marked as feature-owned, so they use the normal attack/damage roll path but
cannot be edited or removed independently. The descriptor's `damage` is the
final die expression after class substitutions; for example, Radiant Sun
Bolt's radiant damage tracks the Monk's current Martial Arts die. Astral Arms
uses the same path for a force attack using the best permitted STR/DEX/WIS
modifier and carries
`reachBonus: 5`/`reachCondition: "onYourTurn"` so only that row gains reach,
and only during the Monk's turn.

Feature attacks configure their ability through `abilityMod`. Their
`attackBonus` and `damageBonus` fields contain only additional bonuses; the
normal renderer and roller add the configured ability modifier and proficiency
bonus.

### Per-Hit Target Context and Chained Outcomes

Features whose result depends on the struck target collect transient context
inside the canonical damage roll; they do not create a parallel encounter
model. Path of the Juggernaut's Demolishing Might asks whether a melee weapon
hit targets a creature, construct, object, or structure. Construct damage adds
a crit-compatible `1d8`; object/structure damage doubles the final total.

Raging Juggernaut melee hits then surface Thunderous Blows as a resolved
post-hit choice (distance, direction, target size, and the Huge+ Strength
save). At level 10, a successful push can chain Hurricane Strike, consume the
character's reaction, resolve the shared Strength save against Prone, and
record the ally reaction opportunity in the attack result.

The transient Attack-action tracker records attack provenance separately from
bonus-action, reaction, and spell attacks. Astral Barrage consults that record
to permit a third Astral Arms attack only while the current Attack action
contains exclusively Astral Arms attacks. Empowered Arms uses the shared
once-per-turn damage-rider path and is scoped to the same feature-owned row.

TGTT Path of the Chained Fury uses a reminder-first on-hit flow. By default,
Spectral Chains choices show the resolved grapple/method DC and the authored
grapple, shove, restraint, or reposition reminder without asking the player to
maintain creature records. The optional **Remember chained creatures** toggle
adds a compact name plus failed/succeeded outcome form for grapple, Chain
Imprisonment, and Chain Control; ordinary shove remains reminder-only.

Optional post-attack decisions appear in one compact side offer rather than
opening a modal automatically. It lists each eligible effect with an **Open**
control and keeps the triggering natural roll, total, and breakdown readable
while the dice toast is present and after it expires. The offer persists through
the damage roll; **Dismiss offers**, the next committed attack, or switching
characters removes it.
Cancelling a pre-roll choice leaves the old offer intact. An opened choice still
uses the roll-aware full modal, but cancelling it does not spend a resource or
remove its offer. Other **Open** controls pause until that choice closes.
Applying an effect removes only that choice for that roll.
Eligibility is checked again on Open: for example, Cruel's critical-hit
temporary-HP die is no longer available if its once-per-turn die was spent on
damage first. Roll-changing fortune interventions remain blocking because later
critical-hit and on-hit decisions depend on their outcome.

Combat and Play Mode render the same opted-in records as a creature name,
Grappled/Restrained badges, the recurring force-damage reminder, chain capacity,
and Release. They deliberately do not expose size, distance, coordinates,
movement budgets, escape-roll resolution, or repeat-damage controls.
`CharacterSheetState` owns save/load and cleanup, while attack and damage math
stay identical with tracking on or off.

### Attack Bonus Calculation

```javascript
const attack = state.buildAutoAttackFromWeapon(weapon);
const breakdown = state.getAttackBonusBreakdown(attack);
const total = breakdown.total;
```

`CharacterSheetState.getWeaponAbilityResolution(attack)` is the shared ability
authority for attack cards, attack rolls, damage cards, and damage rolls. It
first resolves the normal weapon ability (`STR`, `DEX`, finesse, or another
explicit mode), then considers eligible alternate abilities. An alternate wins
only when its modifier is strictly higher; the result includes the selected
ability plus `source`, `sourceFeatureUid`, and a display attribution such as
`INT via Battle Ready`. `getWeaponAbilityMod(attack)` is the numeric wrapper.

EFA and TCE Battle Smith both publish a generic `attackAbility` effect for
magic weapons, but their exact source-qualified feature UIDs remain separate.
Battle Ready uses the shared `CharacterSheetItemUtils.isMagicWeapon` classifier,
so meaningful rarity/flags/bonuses, composed magic facts, and exact valid
Replicate Magic Item provenance qualify. A magical damage type alone does not.
Generated feature items fail closed when provenance is stale, malformed, or
owned by another feature. Removing the feature or magic fact therefore changes
the next display and roll immediately; no resolved ability is persisted.

```text
total = resolvedAbilityMod + profBonus + weaponBonus + featureAttackBonus + stateAttackBonus
```

`buildAutoAttackFromWeapon()` owns the canonical inventory-to-attack conversion.
Its `attackBonus` is **intrinsic/local only**: the source weapon's effective
magic bonus, upgrades, projected material effects, and custom flat bonus.

`getAttackBonusBreakdown()` then adds the character-facing layers exactly once:

- base ability, with finesse resolved before alternate-ability choices;
- the single best eligible substitution (for example, Lies or Bladesong);
- proficiency;
- unconditional feature modifiers;
- active-state modifiers;
- equipped non-weapon item bonuses whose authored scope matches the attack.

The returned buckets are used by Overview, Combat, Play Mode, PDF export, and
NPC export. Consumers must not re-read `bonusWeapon`, upgrades, or material
bonuses from `sourceItem`, because those values are already folded into the
attack descriptor. Roll-only conditionals, ammunition, tactical toggles,
one-shot bonuses, and exhaustion remain outside the standing total.

Signed string bonuses such as `"+2"` are normalized to numbers at the state
boundary. A non-weapon item that repeats one bonus through both structured fields
and `effects[]` contributes only once. Weapon-local bonuses never leak to another
weapon, while broadly authored equipment such as an Ioun Stone can contribute
through the external-item bucket.

### Attack Reach

`getAttackRangeProjection(attack, {meleeReach, isOwnTurn})` is the shared display
projection. A structured weapon reach is combined with the character's reach
above the normal 5-foot baseline, then with attack-local reach. An
`onYourTurn` local bonus is omitted off-turn. The Reach property adds 5 feet only
when the attack has no authored structured reach.

Thrown uses retain their thrown range and return no melee reach. An attack-local
reach value therefore cannot leak to another weapon; a character-wide boon still
adds to each eligible melee attack independently. Spell attacks, including
ranged spells with a distance such as "60 ft." and melee spell attacks with
touch range, keep their authored range even when an equipped item grants
additional melee reach.

TGTT's Rope Dart remains a martial melee weapon in the item catalog, but its
Special rule requires **every** attack (even at 5 feet) to use the Thrown property.
Equipping it builds a ranged, thrown attack with a 15/30-foot range and Finesse
(the better of STR/DEX); ordinary thrown melee weapons still default to melee.
The sheet shows the rope-retrieval rule as an attack reminder, without tracking
where the blade lands or automatically retrieving it. Its Entangling mastery
references `Entangling|GrimHollowPG24` from the external Grim Hollow Player's
Guide (2024) brew in `homebrew/index.json`. The mastery is linked only when
that source is loaded; otherwise its name stays visible without a broken hover.
The sheet does not substitute another mastery effect or automate Entangling.

### EFA Battle Smith Arcane Jolt

Arcane Jolt is one source-qualified post-hit transaction shared by the
summoner's attacks and Steel Defender operations. Combat registers one
`efaArcaneJolt` entry in `_getPostAttackHooks()`. Its predicate accepts only a
live inventory attack whose exact `sourceItem.id` resolves to a magic weapon
through `CharacterSheetState.isMagicWeapon()`. Spell attacks, mundane weapons,
removed items, and generated rows with stale, malformed, or wrong-owner
provenance fail closed. Because the sheet does not know the target's AC, the
handler first asks whether the attack hit; a miss never opens or spends Arcane
Jolt.

The defender route begins only after
`CharacterSheetPage.pUseCompanionOperation()` returns a committed,
hit-confirmed `forceEmpoweredRend` result for the exact owned EFA Steel
Defender. Desktop and Play Mode already delegate to that Page method, so both
routes call the same `pOfferEfaArcaneJolt()` modal rather than maintaining
renderer-specific decisions.

The compact modal shows remaining uses and the once-per-turn status, then
offers **Skip**, **Destructive**, and **Restorative**:

- **Destructive Energy** rolls `2d6` Force damage, or `4d6` at EFA Artificer
  15, against the target hit by the originating attack. It returns a separate
  damage result and never edits or rerolls the base hit.
- **Restorative Energy** requires an explicit character, companion, object, or
  external target; visibility confirmation; and a distance of at most 30 feet
  measured from the attack target. Character/companion/object HP is mutated and
  clamped atomically. External creatures/objects return a manual-application
  result. Dead or vanished companions are rejected; Arcane Jolt never revives
  or changes lifecycle state.

The modal uses the shared `CharacterSheetModal` keyboard contract: focus starts
on the attack-target field, stays trapped, Escape/Skip resolve as an explicit
no-spend cancellation, and close restores focus to the invoking attack or
companion control. Because the underlying renderer may refresh before Jolt
opens or closes, both routes also provide a stable replacement-target getter.
Resource/busy updates use a polite atomic status; validation and transaction
errors keep the dialog open and focus an assertive error region. The existing
combat-target mobile classes stack controls into one column with 44px action
targets.

`CharacterSheetState.pUseEfaArcaneJolt()` preflights the effect, trigger,
target acknowledgement, roll, exact resource, and shared per-turn receipt
before mutation. It commits one use and one receipt. A later modeled-HP or
publication failure restores the resource snapshot, target HP snapshot, and
exact receipt and returns the explicit rollback outcomes. Both trigger sources
use the same key, so a summoner Jolt blocks a defender Jolt and vice versa until
`resetTurnEconomy()`; changing `combatRound` does nothing.

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

Accounts for features like Champion's Improved/Superior Critical — **scoped
to weapon and Unarmed Strike attacks only**, so spell attacks never inherit
a widened crit range:

```javascript
const critRange = state.getCriticalRange({attack});
const isCritical = roll >= critRange;
```

`getCriticalRange({attack, kind, includeItemThreshold})` lives on
`CharacterSheetState` and is the single source of truth for "what beats a
natural 20 for this specific attack." Item thresholds are read only from that
attack's source weapon. Champion-style features, active states, and stance
effects are then composed according to their authored weapon/range scope, with
any stated minimum threshold enforced. Spell attacks pass `{kind: "spell"}` and
never inherit weapon-only critical ranges, including when rolled directly from
the Spells tab or while casting.

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
const mod = state.getInitiative();
const mode = state.getInitiativeRollMode();
const bonusDice = state.getRollBonusDiceFromStates("initiative");

// The controller rolls the d20 using the resolved advantage/disadvantage mode,
// adds the flat modifier once, then rolls and adds each bonus die.
```

### Initiative Modifiers

`CharacterSheetState.getInitiative()` assembles the flat pre-exhaustion modifier:
the Dexterity modifier, Jack of All Trades when applicable, custom initiative
modifiers, named feature bonuses, and equipped item-material bonuses.
`getInitiativeBreakdown()` separates the intrinsic (`canonical`) portion from the
situational effective total and applies exhaustion only to that effective total.

```javascript
const breakdown = state.getInitiativeBreakdown();
// {
//   canonical, // intrinsic flat modifier
//   total,     // effective flat modifier after situational penalties
//   components: [{name, value, icon, isCanonical}],
//   diceBonuses: [{source, dice, sign}],
// }
```

The Overview initiative card formats this breakdown into the same native hover
tooltip used by skill rows. The tooltip lists every named contribution, any
roll-time bonus dice, the effective total, and the intrinsic total when those
two values differ. Clicking the card still rolls initiative.

> **Note:** Buff *dice* bonuses such as **Gift of Alacrity** (`1d8` initiative) are
> **not** added here as a flat number. Because they are a random die they can't
> collapse into the canonical modifier — instead `getRollBonusDiceFromStates("initiative")`
> surfaces them and `_rollInitiative` rolls the die into the roll total at roll
> time (see [Spellcasting → Buff dice on d20 rolls](./07-spellcasting.md#buff-dice-on-d20-rolls-rollbonus--rollpenalty)).

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

Method degree and Stamina cost are independent. The sheet uses the authored
`staminaCost` for fixed-cost methods, preserves explicit zero-cost methods, and
parses an authored range such as `1-3 Stamina Points` for methods whose effect
scales with the amount spent. Degree is never used as a payment fallback.

Normal Combat and Play Mode share the same transaction:

1. Resolve the learned method and validate focus/stance gates.
2. Ask for a variable-cost amount, if required. Cancelling changes nothing.
3. Verify Stamina or the existing Monk ki/focus fallback before rolling or applying effects.
4. Resolve any data-authored random outcome.
5. Spend the selected resource exactly once, dispatch the effect, and save the character.

Blocked actions do not spend resources, roll random outcomes, write activity,
or partially mutate method state. Random target effects such as Spell
Shattering Strike are transient reminders; they are not persisted as conditions
on the player character.

---

## Combat Tab Rendering

The combat tab displays:

1. **Attacks Section**: All configured attacks with roll buttons
2. **Initiative**: Current initiative with roll button
3. **Active States**: Current toggles (Rage, Bladesong, etc.)
4. **Conditions**: Active conditions with effects
5. **Death Saves**: Tracker with success/failure buttons
6. **Combat Spells**: Quick access to commonly used combat spells
7. **Defenses**: AC, resistances, immunities, and vulnerabilities

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

### Editing Damage Defenses

The Defense card's **Edit** action manages only player-authored damage
resistances, immunities, and vulnerabilities. These values persist under
`manualDefenses`; class, species, feature, item, upgrade, and active-state
defenses remain in their existing automatic channels.

`getDefenseBreakdown()` keeps every owner visible even when multiple sources
grant the same damage type. `getEffectiveDefenses()` deduplicates those entries
for rules calculations and display. Removing a manual entry therefore cannot
remove an overlapping automatic defense. Every modal mutation rerenders the
Combat, Overview, and main defense summaries and saves immediately.

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

## Conditional Modifier Picker (Pre-Roll Flow)

Five roll sites in `charactersheet.js` use the same pre-roll picker pattern to let the player opt in to conditional modifiers:

| Roll site | Line | Notes |
|---|---|---|
| `_rollAbilityCheck` | ~L8957 | Probes `check:<ability>` |
| `_rollSavingThrow` | ~L9060 | Probes `save:<ability>`; preserves Evasion passive alert |
| `_rollSkillCheck` | ~L9150 | Probes both `skill:X` and `check:<ability>`, dedupes by ID |
| `_rollToolCheck` | current tool-check helper | Probes `tool:<canonical-key>` and `check:<ability>`; paired skill proficiency supplies advantage |
| `_rollAttack` | ~L9350 | `async`; only adds the picker's bonus delta to avoid double-counting registry mods already folded into `attack.attackBonus` |

### Picker UI — `_pPickConditionalModifiers({rollLabel, conditionalsAvailable})`

Defined at ~L8960. Modal with one row per available conditional:

- Checkbox + clean source name + colored chip (Advantage = green, Disadvantage = red, `+N` or `+dN` = indigo)
- Natural context sentence beneath it (`Applies against poison.`, `Applies while concentrating.`)
- "Apply all" / "Apply none" buttons
- Actions: **Cancel** (abort the roll), **Skip** (roll with zero conditionals applied), **Apply selected**

Skipped silently when `conditionalsAvailable` is empty **or** `settings.skipConditionalPrompt === true`. Returns `{appliedConditionalIds: Set<string>, applied: Array<Entry>, cancelled: boolean}`.

The picker reads `sourceName`, a display-only projection which removes only the
exact `: <condition>` suffix added by prose registration. Stored names and
conditional IDs are unchanged.

### Result Note Format — `_formatAppliedConditionalsNote(applied)`

Each opted-in conditional contributes one line to the roll result note, prefixed with ⚡:

```
⚡ Advantage from Dauntless Heritage against being frightened
⚡ +2 from Stout Resilience against poison
⚡ +d10 from Poison Expert against poison
```

### Settings Toggle

The dice settings dropdown (in `charactersheet.html` near L256) has a **"Skip conditional prompts"** checkbox wired to `settings.skipConditionalPrompt` (`_initDicePicker`, ~L8336). Toggled at runtime; persists with the character.

---

*Previous: [Feature Calculations](./05-feature-calculations.md) | Next: [Spellcasting](./07-spellcasting.md)*


## Data-driven attack allowances and target riders

Attack-action allowances apply to every qualifying feature attack. Chained Fury
Unchained Fury grants a third attack only while every Attack-action attack uses
Manifest Chains; mixed sequences return to the normal allowance. Chained Fury
adds target-effect metadata only while its optional tracker is enabled. Its
compact modal records identity and explicit save outcomes, and the feature
handler persists only successful grapple/restraint states. The final grapple DC
is assigned after Combat Method resolution so spellcasting-aware Hexblade and
Bladesinger overrides are respected.
