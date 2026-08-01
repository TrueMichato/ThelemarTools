# Toggle Abilities System

This document details the toggle abilities (active states) system that manages activatable features like Rage, Bladesong, and combat stances.

## Overview

Toggle abilities are features that can be activated and deactivated, providing temporary effects while active. The system handles:

- Standard D&D abilities (Rage, Wild Shape, Patient Defense)
- Wizard features (Bladesong)
- Blood Hunter hemocraft (Crimson Rite and Order of the Lycan's Hybrid Transformation)
- Way of the Astral Self manifestations (Arms, Visage, Body, and Awakened)
- XPHB Light Domain reactions and auras (Warding Flare and Corona of Light)
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
| `trigger` | object | Optional in-play control `{label, actionType, effectType}` backed by a matching active effect |
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

### Astral Self state lifecycle

The four Astral Self manifestations are separate active states. Arms and Visage
can be activated independently, Body requires both, and Awakened activates the
complete set while deducting its five-point cost only once. Dependency teardown
is bidirectional: ending Arms or Visage ends Body and Awakened, while ending
Awakened ends all three components. Their `endConditions` also route through the
generic incapacitation/0-HP teardown path.

### XPHB Light Domain states

- **Warding Flare** is a one-attack reaction state. Activating it spends one use
  from the Wisdom-sized Warding Flare pool and records disadvantage for the
  triggering attack against the Cleric. At Cleric 6, the pool recharges on a
  Short or Long Rest and activation also rolls `2d6 + Wisdom modifier` temporary
  HP, with a direct Apply to Self control.
- **Corona of Light** is an action-activated, one-minute aura with 60 feet of
  bright light plus 30 feet of dim light. It spends one use from its
  Wisdom-sized pool, can be dismissed, and marks enemy saves against Radiance
  of the Dawn and Fire/Radiant-damage spells as disadvantaged while active.

Arms uses `variablePointSpend` so the level 6+ UI can offer Arms for one
Ki/Focus point or Arms plus Visage for two. Visage and Body expose resolved
`trigger` controls for speech modes and Deflect Energy; the trigger resolver
applies ranges, ability modifiers, and action-economy costs before rendering.

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
{type: "conditionImmunity", target: "frightened"}
{type: "speedReductionImmunity"}
{type: "forcedMovementImmunity", target: "ground"}
```

### Special Effects

```javascript
{type: "rageDamage", target: "melee:str"}     // Uses calculated rage damage
{type: "sizeIncrease", value: 1}              // Count as one size larger
{type: "replaceStats", targets: ["str", "dex"]} // Wild Shape stat replacement
{type: "note", value: "Description text"}     // Informational note
```

### Speeds that track the walking speed

An active state can grant a speed that is *equal to* the character's walking
speed rather than a fixed number. Set `equalToWalk` instead of `value`; it is
resolved at the READ site (`getSpeed()` / `getSpeedByType()`), so a later boot
of Speed or a racial bonus is picked up automatically and the effect never
caches a stale number.

```javascript
{type: "flySpeed", equalToWalk: true}   // e.g. Circle of the Sea's Stormborn
{type: "swimSpeed", value: 30}          // a plain fixed value still works
```

> **Gotcha.** The description-text modifier pipeline is a *second, independent*
> source of speed grants: `_processFeatureModifiers` registers a `speed:<type>`
> `equalToWalk` named modifier parsed straight out of the feature's prose, and
> it is enabled unless `_extractCondition` recognises a gating phrase. A feature
> whose text reads "…confers two more benefits **while active**" needs that
> phrasing in `_extractCondition`, or the speed leaks as an always-on bonus even
> though the active state is off.

### Save-for-damage bursts (`trigger.effectType: "saveDamageBurst"`)

A state whose `trigger` declares `effectType: "saveDamageBurst"` gets a generic
"roll damage, name the save" button in the combat panel. The state's effect
descriptor may leave the scaling **unresolved** — `getActiveStateTrigger()`
resolves it — which keeps the effect provider out of the speed/calculation
re-entrancy cycle:

| Field | Meaning |
|---|---|
| `diceAbility` / `diceMinimum` / `dieSize` | `max(diceMinimum, mod(diceAbility))` dice of `dieSize` → `resolvedDamage` |
| `damage` | a literal formula, used when no `diceAbility` is given |
| `dcCalculation: "spellSaveDc"` | resolve the DC live → `resolvedDc` |
| `dc` | a literal DC, wins over `dcCalculation` |
| `saveAbility`, `damageType`, `range`, `pushDistance`, `maxPushSize` | surfaced in the roll result |

### Placement-aware states

`addActiveState` / `activateState` persist a `placement` string alongside the
other whitelisted option keys. `_getSupplementalActiveStateEffects(stateTypeId,
state)` receives the live state record, so a state can emit different effects
depending on where the player put it — Circle of the Sea's Oceanic Gift uses
this to withhold Stormborn's resistances and fly speed when the Emanation is
placed on an ally rather than on the druid.

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

Rage can receive subclass-scoped supplemental effects without changing the
global `rage` definition. Path of the Juggernaut uses this path for Spirit of
the Mountain (Prone and involuntary ground-movement immunity) and Unstoppable
(Frightened, Paralyzed, Prone, and Stunned immunity plus ignored speed
reductions). Existing conditions remain stored but their active-state effects
are suppressed while the immunity applies, then resume when Rage ends.

#### Resolute Stance (Juggernaut Barbarian)

`resoluteStance` is a free, start-of-turn state which expires at the start of
the next turn. It grants Grappled immunity, imposes disadvantage on the
Juggernaut's weapon attacks, and exposes disadvantage on attacks against the
Juggernaut through the normal defense-effect pipeline.

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

#### Hybrid Transformation (Blood Hunter: Order of the Lycan)

Hybrid Transformation uses a short-rest pool (one use at level 3, two at level
11, unlimited at level 18). Its state supplies Strength check/save advantage,
conditional nonsilvered nonmagical B/P/S resistance, the Predatory Strike
natural weapon, transformed walking-speed bonus, Lycan attack/damage scaling,
and the non-heavy-armor AC bonus. Conditional resistance metadata remains
qualified in the Defenses display rather than appearing as unconditional B/P/S
resistance.
Level 11 regeneration is applied when combat rounds advance while the Lycan is
below half hit points, including the first turn when combat starts. Starting a
turn below half hit points also rolls the
Bloodlust Wisdom save (with Brand of the Voracious advantage, or automatic
failure while concentrating/Raging). Finite transformations end during a rest;
level 18 mastery transformations remain active until manually ended. Any Lycan
automatically reverts at 0 HP.

Crimson Rite is a separate active state created from a selected `CR` optional
feature. Activation rolls the Hemocraft Die as an HP cost, records the selected
weapon (including Predatory Strike), and adds the rite's typed damage only to
that weapon. Predatory Strike exposes both its bludgeoning and slashing damage
choices as rollable attacks while sharing one rite-empowered weapon identity.

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

#### Sun Shield (Sun Soul Monk)
```javascript
sunShield: {
    effects: [
        {
            type: "retaliationDamage",
            target: "meleeAttacker",
            value: 5,
            abilityMod: "wis",
            damageType: "radiant",
        },
    ],
    trigger: {
        label: "Retaliate",
        actionType: "reaction",
        effectType: "retaliationDamage",
    },
    duration: "Until extinguished",
    activationAction: "bonus",
}
```

Triggered active-state effects are resolved through
`getActiveStateTrigger()`. It adds any configured ability modifier to the
effect value, then the Combat tab renders the trigger as a real action-economy
control. Sun Shield therefore deals `5 + WIS` radiant damage and consumes the
character's reaction while combat tracking is active.

#### Exalted Champion (Oath of the Crown Paladin, L20)

```javascript
exaltedChampion: {
    preferCuratedEffects: true,
    effects: [
        {type: "resistance", target: "damage:bludgeoning"},
        {type: "resistance", target: "damage:piercing"},
        {type: "resistance", target: "damage:slashing"},
        {type: "advantage", target: "save:wis"},
    ],
    duration: "1 hour",
    activationAction: "action",
    resourceName: "Exalted Champion",
}
```

Two conventions this state exists to demonstrate:

**Damage-defence targets must be namespaced.** A `resistance` / `immunity` /
`vulnerability` effect is read through `_getDamageDefenceFromStates`, which
accepts `damage:<type>` (the canonical form — always emit this) and, since
CS-BUG-050, a bare damage type from the prose parser. Non-damage targets such
as `"ac"` or `"speed:walk"` are whitelist-rejected, so they can never be
mistaken for a damage type. Advantage, by contrast, uses the **bare** form:
`save:wis`, `check:wis`, `skill:perception`.

**`preferCuratedEffects: true`** pins the curated `effects` array in place of
whatever `parseEffectsFromDescription` extracts from the feature text. Use it
whenever the prose is lossy — here the parse duplicated bludgeoning and dropped
the "from nonmagical weapons" caveat. Without the flag, a non-empty parse wins.

#### Umbral Form (Shadow Magic Sorcerer, L18)

```javascript
umbralForm: {
    preferCuratedEffects: true,
    effects: [
        {type: "resistance", target: "damage:acid"},
        {type: "resistance", target: "damage:bludgeoning"},
        // …9 more: cold, fire, lightning, necrotic, piercing, poison,
        //          psychic, slashing, thunder — every type EXCEPT force
        //          and radiant.
    ],
    duration: "1 minute",
    activationAction: "bonus",
    resourceName: "Sorcery Points",
    resourceCost: 6,
}
```

"Resistance to all damage except force and radiant" has to be enumerated. There
is no exclusion syntax, and there deliberately isn't one — a wildcard-minus-list
form would have to be re-resolved every time the damage-type table changes, and
`_getDamageDefenceFromStates` would lose its whitelist guarantee. Eleven explicit
`damage:<type>` entries are also self-documenting at the call site and let a test
assert the exact count (11 while active), which is a stronger probe than "force
is not in the list".

`resourceCost: 6` on the state definition is what `getActivatableFeatures()`
resolves the Sorcery Point spend from; `_findResource` matches
`"Sorcery Points"` bidirectionally, so a feature declaring
`consumes: {name: "Sorcery Point"}` (singular) resolves to the same pool.

**Name collisions.** Umbral Form's sibling states in the TGTT Shadow Knight
tree (`eyesOfTheDark`, `umbralCoating`, `shadowCloak`, `shadowKnightDarkness`)
all carry `noNameDetect: true` — see CS-BUG-083. `detectActivatableFeature()`
is static and matches purely on feature name, so without the flag a Shadow
Magic Sorcerer's *passive* "Eyes of the Dark" was classified as the Shadow
Knight's activatable state of the same name. Add `noNameDetect: true` to any
state whose name is generic enough to appear in unrelated content; such states
are then reachable only through an explicit `activateState(key)` call or a
`FEATURE_CLASSIFICATION_OVERRIDES` entry.

#### Launch Momentum (Steel Hawk Fighter, `GriffonsSaddlebag2`)

```javascript
launchMomentum: {
    name: "Launch Momentum",
    icon: "🦅",
    activationAction: "bonus",
    // Armed by useLaunch(); eaten by the next melee attack.
    consumeOnAttack: true,
    // "Launch" is a generic English word — never name-detect it.
    noNameDetect: true,
}
```

The effects are supplied per-activation by `getLaunchMomentumEffects()` rather
than being fixed on the state type, because all three riders are level-scaled:

```javascript
[
    {type: "advantage", target: "attack:melee"},
    // "of the weapon's type" — left untyped so the roller reports it under the
    // weapon's own damage type instead of inventing one.
    {type: "extraDamage", value: "1d8"|"1d10"|"1d12", damageType: "", meleeOnly: true},
    {type: "critRange", value: 19},   // Eagle Eye, level 10+ only
]
```

Two conventions worth copying:

**`meleeOnly` is honoured by the damage roller.** `getExtraDamageFromStates()`
propagates the flag and `_rollDamage` filters on it, so a rider that reads "on a
melee weapon attack" cannot leak onto a ranged attack or a spell.

**`target: "attack:melee"` matches a `"attack:melee:str"` query.** Both
advantage aggregators — `hasAdvantageFromStates()` (the roll path) and
`_effectMatchesType()` (the badge path, via `getAdvantageState()`) — honour the
hierarchical attack prefix. They did not agree before CS-BUG-087.

#### Eagle Eye Sight (Steel Hawk Fighter, `GriffonsSaddlebag2`)

```javascript
eagleEyeSight: {
    name: "Eagle Eye Sight",
    icon: "👁️‍🗨️",
    activationAction: "free",
    noNameDetect: true,
}
```

A player-driven toggle rather than a passive bonus, because the doubled
proficiency applies only to **sight-based** Wisdom (Perception) checks and the
sheet cannot know which checks those are. `setEagleEyeSightActive(true)` supplies
`customEffects: [{type: "bonus", target: "skill:perception", value: …}]`, where
the value is **0** when Perception is already expertise — doubling an
already-doubled bonus is worth nothing. Note this state is why CS-BUG-086 was
found: `skill:<name>` bonus targets were being discarded outright by
`getSkillBonusFromStates()`.

### Combat Stances (TGTT/Homebrew)

#### Astral Self (Way of the Astral Self Monk)

Four cooperating states — `astralArms` (level 3), `astralVisage` (6),
`astralBody` (11) and `awakenedAstralSelf` (17). They demonstrate three
patterns worth reusing:

**State dependencies.** `astralBody` declares
`requiresStates: ["astralArms", "astralVisage"]` and cannot be activated
until both are present. It also declares `endConditions` naming its
prerequisites, so it tears down automatically when either ends.

```javascript
astralBody: {
    requiresStates: ["astralArms", "astralVisage"],
    endConditions: ["Arms or Visage ends", "You are incapacitated or die"],
    activationAction: "free",
    resourceCost: 0,
    trigger: {label: "Deflect Energy", actionType: "reaction", effectType: "damageReduction"},
}
```

**Conditional, relative reach.** Astral Arms grants an attack whose reach is
*five feet greater than normal, on your turn only* — not a flat ten feet. The
granted attack carries `reachBonus` and `reachCondition` rather than an
absolute `reach`, so it composes correctly with a Large creature, the Reach
weapon property and any other reach modifier:

```javascript
{damage: martialArtsDice, damageType: "force", abilityMod: "wis",
 reachBonus: 5, reachCondition: "onYourTurn", isMelee: true}
```

`getAttackReach(attack, {isOwnTurn})` returns `base + reachProperty +
attackReachBonus`, zeroing the bonus when `reachCondition` is `onYourTurn`
and the roll is off-turn. Prefer this shape over a hardcoded reach for any
future feature that extends reach situationally.

**Generic incapacitated/death teardown.** `_deactivateStatesForEndCondition()`
reads each state's own `endConditions` strings and deactivates every active
state whose conditions mention incapacitation, unconsciousness or death. It is
called from `setCurrentHp()`, `setHp()`, `addCondition()` and
`setConditions()`, so any state that documents such an end condition gets
correct teardown for free — no per-feature hook. This replaced a hardcoded
`deactivateState("hybridTransformation")` at 0 HP; Blood Hunter's Lycan
transformation now tears down through the same path because its
`endConditions` already listed `"Unconscious"`.

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
