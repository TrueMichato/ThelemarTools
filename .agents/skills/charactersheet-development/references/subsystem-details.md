# Subsystem Details

Detailed reference for combat, active states, spells, items, NPC export, rest, and custom abilities.

## Contents
- Active States / Toggle Abilities (ACTIVE_STATE_TYPES, storage, mutual exclusivity, bonus aggregation, concentration cascade, Steady Aim)
- Combat System (attack bonus, sneak attack, action economy, weapon mastery)
- Spell Data Format (known/prepared, innate, spell slots)
- Inventory Item Format (items, item bonuses, weapon bonus fields)
- NPC Exporter (convertStateToMonster, CR estimation, custom source)
- Rest Mechanics (short rest, long rest, item charges)
- Combat Action Effects Pipeline (parsing, classification, effect schema, modals, subclass grants)
- Custom Abilities (data structure, effect routing, reapply on load)

## Active States / Toggle Abilities

### ACTIVE_STATE_TYPES (24 types defined)

Core states: `rage`, `bladesong`, `wildShape`, `dodge`, `recklessAttack`, `steadyAim`, `patientDefense`, `stepOfTheWind`, `flurryOfBlows`, `focusedAim`, `deflectMissiles`

Each state type defines:
```javascript
{
    id: "rage",
    name: "Rage",
    icon: "💢",
    effects: [{type, target, value?, abilityMod?}],
    duration: "1 minute",        // "1 minute" = 10 rounds, "This turn" = 1 round
    endConditions: ["..."],
    resourceName: "Rage",
    resourceCost: 1,
    activationAction: "bonus",   // "bonus"|"action"|"free"|"reaction"
    exclusiveWith: ["bladesong"], // Mutual exclusivity
    breaksConcentration: true,   // Rage breaks concentration on activate
    detectPatterns: ["^rage$"],  // Regex for auto-detection from feature text
    requiresClass: "barbarian",
    requiresClassLevel: 1,
}
```

### State Storage Format

`_data.activeStates[]` entries:
```javascript
{
    id: "uuid",
    stateTypeId: "rage",
    active: true,
    customEffects: null,          // Overrides stateType.effects if set
    roundsRemaining: 10,          // Decremented each round
    grantsConditions: ["frightened"], // Conditions this state grants to targets
    isCondition: false,           // true = this state IS a condition
    isSpellEffect: false,         // true = from a spell (concentration-breakable)
    concentration: false,
}
```

### Mutual Exclusivity

Hard-coded: Rage ↔ Bladesong. Enforced in `activateState()` — activating one auto-deactivates the other.

### Bonus Aggregation

`getBonusFromStates(type)` checks effects hierarchically:
- `"check:str:athletics"` → also checks `"check:str"` → also checks `"check"`
- Returns sum of all matching `value` fields + resolved `abilityMod` fields

### Concentration Breaking Cascade

When Rage (or any state with `breaksConcentration: true`) activates:
1. Calls `breakConcentration()`
2. Finds ALL states with `isSpellEffect && concentration`
3. Removes conditions those states granted (via `grantsConditions`)
4. Disables currently-concentrating custom abilities

### Steady Aim Two-Phase Pattern

Steady Aim has TWO effects: `advantage` on next attack + `speedZero` (speed = 0).
After one attack, `_consumeOnAttackStates()` removes ONLY the advantage effect. The `speedZero` survives until turn end.

## Combat System

### Attack Bonus Calculation
```
total = abilityMod + profBonus + weaponBonus + featureAttackBonus + stateAttackBonus
```
- `weaponBonus`: from magic item's `bonusWeapon` + `bonusWeaponAttack`
- `featureAttackBonus`: from feature calculations
- `stateAttackBonus`: from `getBonusFromStates("attack")`

### Sneak Attack Mechanics

- **Eligibility**: Weapon must have Finesse ("F") or be ranged ("T")
- **Per-turn limit**: Tracks `_lastSneakAttackRoundUsed` — one SA per round in combat
- **Cunning Strikes**: Subtract dice BEFORE rolling (e.g., 5d6 SA - 2d6 CS cost = 3d6 damage)
- **Auto-enable**: After eligible attack when conditions met (advantage or ally adjacent), SA auto-activates
- **Advantage detection**: Checks BOTH `rollD20` mode AND `hasAdvantage`/`hasDisadvantage` flags from active states

### Action Economy Tracking

`_turnActionUsage`: tracks `{action, bonus, reaction}` booleans per turn. Reset on turn advance.

### Weapon Mastery Effects

All 8 XPHB properties tracked: Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex. Slots scale by class/level.

## Spell Data Format

### Known/Prepared Spells (`_data.spellcasting.spellsKnown[]`)
```javascript
{
    name: "Fireball",
    source: "PHB",         // MUST match for migration logic
    prepared: false,       // For prepared casters
    concentration: false,  // MUST be boolean (migrated on load)
    ritual: false,         // MUST be boolean
}
```

### Innate Spells
```javascript
{
    name: "Misty Step",
    source: "PHB",
    innate: true,
    uses: {current: 1, max: 1},
    usesEach: false,       // "3/day each" vs "3/day total"
    recharge: "long",      // "short"|"long"
    sourceFeature: "Fey Step",  // What grants this
}
```

### Spell Slots (`_data.spellcasting.spellSlots`)
```javascript
{
    1: {current: 4, max: 4},
    2: {current: 3, max: 3},
    // ... keyed by spell level number
}
```

## Inventory Item Format

### Items (`_data.inventory[]`)
```javascript
{
    item: {name, source, rarity, type, ...},  // Full 5etools item object
    quantity: 3,
    equipped: true,
    attuned: false,
}
```

### Item Bonuses (tracked separately)
```javascript
_data.itemBonuses: {
    savingThrow: 0,
    spellAttack: 0,
    spellSlots: {3: 1},  // Level → additional slot count
}
```

Magic weapon bonuses are THREE separate fields on the item:
- `bonusWeapon`: general bonus (applies to both attack and damage)
- `bonusWeaponAttack`: attack-only bonus
- `bonusWeaponDamage`: damage-only bonus

## NPC Exporter

### Key Method: `convertStateToMonster(state, options)`

**Output format**: 5etools homebrew monster JSON. Key structural requirements:
- **AC**: `[{ac: 15, from: ["natural armor"]}]` — array of objects, NOT flat number
- **HP**: `{average: 52, formula: "8d8 + 16"}` — both fields required
- **Size**: `["M"]` — array

### CR Estimation Algorithm
```
baseline = totalLevel <= 1 ? 0.5 : max(1, level - 1)
defensiveAdjust = floor((hp - 40)/45 + (ac - 13)/2)
offensiveAdjust = floor((avgAttackBonus - 5)/2 + (maxDamageScore - 10)/8 + (hasSpells ? 1 : 0))
finalCR = max(0.125, baseline + (defensiveAdjust + offensiveAdjust) / 3)
```

### Custom Source Metadata
Users can configure custom source with `charsheet-npc-export-source-config` storage key.

## Rest Mechanics

### Short Rest
- **Hit Dice**: d{classHitDie} + CON mod per die spent; minimum 1 HP healed
- **Arcane Recovery** (Wizard): Select slot levels to recover, capped by LEVEL SUM (not count). "Max 5 levels" means any combo summing ≤5. No 6th+ slots.
- **Natural Recovery** (Land Druid): Same mechanic as Arcane Recovery
- **Sorcerous Restoration** (Sorcerer 20): Auto-applies via `state.applySorcerousRestoration()`, not manual
- **Stamina pool** (TGTT): Restores on BOTH short and long rest

### Long Rest
- Full HP + half hit dice recovered (minimum 1 per die type)
- All spell slots 1-9 restored
- Class resources with `recharge: "long"` restored
- Exhaustion reduced by 1
- Temp HP reset, death saves reset to 0/0
- Concentration optionally broken

### Item Charge Restoration
Recognizes recharge types: `restLong`, `dawn`, `dusk`, `midnight` (on long rest), `restShort` (short rest only). Parses `rechargeAmount` dice notation (e.g., `"1d6 + 1"`) and rolls if present.

## Combat Action Effects Pipeline

The combat action effects pipeline transforms class/subclass feature text into structured combat actions displayed in the combat tab with dice rolling, effect application, and choice modals.

### Pipeline Overview

```
Feature text → _parseCombatActionEffects() → combatActionEffects object
                                                    ↓
combatActionEffects → _getFeatureSpecificContent() → modal HTML
                                                    ↓
User clicks "Use" → _useCombatAction() → _applyCombatActionEffects() → state changes
                                       → _rollCombatActionDice() → dice results
```

### Feature Classification

Features are classified into display categories via `FEATURE_CLASSIFICATION_OVERRIDES`:
- `"combat"` — Shown in combat tab with Use button (Flurry of Blows, Step of the Wind, Wall Walk, Instant Step, Whirlpool Strike, Wind Strike, Religious Training)
- `"passive"` — Applied automatically (Disciplined Survivor, Agile Acrobat)
- Toggle states remain in `ACTIVE_STATE_TYPES` (Patient Defense, Rage, Bladesong)

### Effect Schema

`_parseCombatActionEffects()` extracts from feature text:
```javascript
{
    actionType: "Action" | "Bonus Action" | "Reaction" | "Free",
    cost: { resource: "Ki Points", amount: 1 },
    damage: { die: "1d10", type: "force", scaling: "martialArtsDie" },
    bonusDamage: { die: "1d6", condition: "per subsequent hit" },
    range: "20/60 ft",
    save: { ability: "dex", dc: "combatMethodDC" },
    saveBonuses: [{ target: "save:con", value: "+proficiency" }],
    applyCondition: { name: "Invisible", duration: "until start of next turn", self: true },
    grantsAdvantage: true,
    isMultiTarget: true,
    choiceModal: true,  // Detected from "replace" wording (e.g., FoHaH replaces FoB attack)
    staminaCost: 2,
}
```

### Modal Rendering

`_getFeatureSpecificContent()` returns feature-specific HTML for the combat action modal:
- **Flurry of Blows**: Strike count (2, or 3 at L10 with Heightened Focus), healing/harm hint when `hasFlurryOfHealingAndHarm`
- **Step of the Wind**: Dash/Disengage description, jump bonus
- **Wall Walk**: Spider Climb self-cast description, duration
- **Instant Step**: Range display, invisibility condition preview
- **Wind Strike**: Ranged attack with advantage indicator, conditional bonus damage
- **Whirlpool Strike**: Multi-target creature count input, per-hit damage

`_renderModalRollSection()` adds dice roller UI when `damage` or `save` present. `_renderEffectsPreview()` shows effect badges (conditions, advantage, disadvantage).

### Choice Modals

`_showCombatActionChoiceModal()` presents branching options when `choiceModal: true`:
- **Flurry of Healing and Harm** (Mercy Monk L11): Replaces one FoB strike with Hand of Healing or Hand of Harm
- Detection: Parser finds "replace" / "in place of" wording in feature text
- Integration: FoB modal shows choice hint, clicking opens sub-modal

### Whirlpool Strike Modal

`_showWhirlpoolStrikeModal()` implements a multi-step flow:
1. User selects number of creatures (1-N)
2. For each creature, rolls attack + applies per-hit bonus damage (1d6)
3. Results displayed in aggregate

### Subclass Tradition Auto-Grants

`_subclassGrantedTraditions` maps subclass keys to combat traditions:
```javascript
_subclassGrantedTraditions: {
    "warder": ["temperedIron", "gallantHeart"],
    "tgttArcaneArcher": ["bitingZephyr"],
    "tgttMercyMonk": ["sanguineKnot"],
}
```
Applied via `combatTradition` effect type during feature calculations. Cleared and re-applied each `getFeatureCalculations()` call.

### Test Coverage

- `CharacterSheetCombatActionEffects.test.js` — 90 tests: effect pipeline, modal rendering, dice rolling, choice modals, Patient Defense preview, FoHaH choice integration
- `CharacterSheetCombatMethodsSurvey.test.js` — 81 tests: all 17 traditions parsed, stance integration, subclass grants, degree progression, DC calculation, stamina pool

## Custom Abilities

### Data Structure
```javascript
{
    id: "uuid",
    name: "Ability Name",
    icon: "⚔️",           // From 48+ emoji options
    category: "combat",    // combat|magic|roleplay|etc.
    description: "Free text",
    effects: [{type, target, value}],  // Same effect types as active states
    toggleable: false,     // If true, creates an active state
}
```

### Effect Routing
Custom ability effects go to different subsystems depending on type:
- **Numeric bonuses** (ac, damage, initiative): Registered as named modifiers
- **Advantage/Disadvantage**: Create active states
- **Resistances/Immunities**: Added directly to `_data`
- **Spells**: Registered as innate spell grants
- **Proficiencies**: Added via `addSkillProficiency()`
- **Toggleable**: Auto-create active state entries when toggled on

### Reapply on Load
`_reapplyCustomAbilityEffects()` runs during `loadFromJson()` to re-register all custom ability effects after deserialization.

## Favorites System
**Files**: state in `charactersheet-state.js` (~L22198–22365), UI in `charactersheet.js` (~L5837–6160).

Cross-tab "star this thing" backing the Actions hub favourites strip. `_data.favorites = [{id: "type:idSuffix", type, name, meta?}]`. Cap 8 by default.

API: `isFavorite(type, idSuffix)`, `addFavorite(favData, {max})`, `removeFavorite(id)`, `toggleFavorite(favData, {max})` (returns `"added"|"removed"|null`), `_resolveFavorite(fav)` (re-resolves entity, handles renames), `isFavoriteResolved(fav)`, `getOrphanedFavorites()`, `cleanupOrphanedFavorites()` (manual; orphans are NOT auto-pruned to protect against transient data-load failures).

Items use a parallel legacy favourites system that predates this one — don't duplicate.

## Apply Buff Modal
**Files**: button in `charactersheet.js` (~L6411, Active States section, class `charsheet__apply-buff-btn`), helpers in `charactersheet-buffpicker-helpers.js`, effect application in `charactersheet-spells.js` (`_applyBuffEffects` ~L4318).

Lets non-casters apply party-cast buffs (Aid, Bless, Haste, Mage Armor) directly. Uses the **same** `_parseBuffs` registry as the casting flow, so an applied buff is mechanically identical to a cast one.

Helpers (pure, no DOM): `BUFF_CATEGORY_ORDER` (5 categories), `BUFF_CATEGORY_META`, `categoriseBuffEntry(spec)`, `buildBuffEffectChip(eff)`, `getBuffEffectChips(spec)`, `formatBuffDuration(duration, concentration)`, `isBuffSpellActive(displayName, activeStates)`.

Pipeline prefers `registryEffects` over parsed `buffs`; respects concentration cascade; disables already-active buffs with a badge.

## Lore Skills (TGTT)
**Files**: state in `charactersheet-state.js` (L6448–6492), UI in `charactersheet.js` (`_renderLoreSkillsSection` ~L2849).

TGTT variant rule: character-defined narrow knowledge skills with a flat per-skill bonus (PB added on top at roll time, no ability scaling). `_data.loreSkills = [{name, bonus}]`. API: `getLoreSkills()`, `setLoreSkillBonus(name, bonus)` (floored at 0), `removeLoreSkill(name)`. Skills with `isLoreSkill: true` are filtered out of the main Skills table (charactersheet.js L2754–2755) and rendered in their own section beneath it. Non-TGTT characters never see the section.

## Conditional Modifiers (Unified Pipeline)
**Files**: helpers + aggregator in `charactersheet-state.js` (L28518–28750), picker + roll sites in `charactersheet.js` (L8960–9610), settings checkbox in `charactersheet.html` (~L256) wired in `_initDicePicker` (~L8336).

Two equivalent encodings for conditional advantage/disadvantage/bonus modifiers:
1. **Text-parsed**: `{type: "save:all", advantage: true, conditional: "against being frightened"}`
2. **Registry sub-typed**: `{type: "save:advantage:frightened"}` — sub-type slot accepts conditions, damage types, and `magic`/`disease`/`spells`

Both flow through the same gating + picker pipeline:
- `_isConditionalSaveSubtype(subtype)` classifies sub-types (returns false for ability codes/`all`/standard skills, true for conditions/damage types/keywords)
- `getModifiersForType` synthesizes a `conditional` field on registry sub-typed entries when queried via base type (e.g. `save:dex`), so both encodings appear identical to the aggregator
- `aggregateModifiers(type, {appliedConditionalIds = new Set()})` gates conditionals off by default, surfaces them in `result.conditionalsAvailable: [{id, name, conditional, advantage?, disadvantage?, bonus?, target?}]`, dedupes via `_buildConditionalModId`
- `getAdvantageState(type, opts)` / `getModifierBonus(type, opts)` forward opts unchanged
- Roll handlers (`_rollAbilityCheck`, `_rollSavingThrow`, `_rollSkillCheck`, `_rollAttack`) probe → `_pPickConditionalModifiers` modal → re-aggregate → emit `⚡ Name (effect, condition)` lines in the result note via `_formatAppliedConditionalsNote`
- `_rollAttack` is `async` and only adds the picker's bonus delta (not the full re-aggregated bonus) to avoid double-counting registry mods already folded into `attack.attackBonus`
- Escape hatch: `settings.skipConditionalPrompt` suppresses the picker; conditionals simply don't apply (no "always apply" mode by design — that would re-introduce the Dauntless Heritage bug)
