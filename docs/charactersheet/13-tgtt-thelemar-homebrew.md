# TGTT (Traveler's Guide to Thelemar) Homebrew Support

This document catalogs all Thelemar homebrew content implemented in the character sheet, including variant rules, classes, subclasses, races, feats, and optional features.

---

## Implementation Status Summary

| Category | Implemented | Deferred/Pending | Tests |
|----------|------------|------------------|-------|
| **Variant Rules** | 7/7 | 0 | ✅ |
| **Classes** | 2/2 | 0 | ✅ |
| **Class Variants** | 12/12 | 0 | ✅ |
| **Subclasses** | 40+ | 0 | ✅ |
| **Races** | 4+ | Minor gaps | ✅ |
| **Feats** | 4/5 | 1 narrative | ✅ |
| **Combat Methods** | 17/17 traditions | 0 | ✅ |
| **Battle Tactics** | 13/13 | 0 | ✅ |
| **Dreamwalker Abilities** | 11/11 | 0 | ✅ |

**Total TGTT Tests**: 737 passing

---

## Variant Rules

All Thelemar variant rules are implemented as toggleable settings:

### ✅ Implemented

| Rule | Setting Key | Description |
|------|-------------|-------------|
| **Exhaustion** | `exhaustionRules: "thelemar"` | -1 to all rolls and DCs per level, max 10 before death (vs 6 in standard, -2/-4/etc in 2024) |
| **Carry Weight** | `thelemar_carryWeight` | 50 + 25 × STR modifier (min 50) instead of STR × 15 |
| **Linguistics Bonus** | `thelemar_linguisticsBonus` | +1 Linguistics per known language except Common |
| **Jumping** | `thelemar_jumping` | Modified high/long jump formulas |
| **Critical Rolls** | `thelemar_criticalRolls` | Nat 1 auto-fails, nat 20 auto-succeeds (all checks) |
| **ASI + Feat** | `thelemar_asiFeat` | At **character level 4** (not class level 4), the level-up grants BOTH an ASI and a feat. Fires exactly once per character, on the level-up that brings the total character level to 4 — regardless of which class is being leveled. |
| **Item Utilization** | `thelemar_itemUtilization` | CON-based limits on consumable items |
| **Spell Rarity/Legality** | `thelemar_spellRarity` | Applies Thelemar spell rarity tags and legality rules |

### Settings Location

```javascript
// In CharacterSheetState defaults
settings: {
    exhaustionRules: "thelemar",
    prioritySources: ["TGTT"],
    thelemar_carryWeight: true,
    thelemar_jumping: true,
    thelemar_linguisticsBonus: true,
    thelemar_criticalRolls: true,
    thelemar_asiFeat: true,
    thelemar_itemUtilization: true,
    thelemar_spellRarity: true,
}
```

---

## Classes

### Dreamwalker (Prestige Class)

A 10-level prestige class that manipulates the Dreamtime.

#### ✅ Core Features

| Feature | Level | Implementation |
|---------|-------|----------------|
| **Focus Pool** | 1 | `focusPool = level + WIS mod` |
| **Focus Die** | 1-10 | d6 → d8 (L3) → d10 (L6) → d12 (L10) |
| **Focus Save DC** | 1 | `8 + proficiency + WIS mod` |
| **Dreamwalker Abilities** | 1 | 2 abilities via DW:C / DW:S optional features |
| **Dream Touched** | 2 | Walking rest/meditation |
| **Lucid Mind** | 4 | Advantage vs frightened |
| **Shaper** | 5 | Dreamtime manipulation |
| **Sight Beyond Sight** | 7 | True sight capabilities |
| **Dream Within a Dream** | 8 | Nested dream access |
| **Awakened** | 10 | Capstone - full dream mastery |

#### ✅ Dreamwalker Abilities (11 total)

All abilities tracked with prerequisite validation:

| Ability | Type | Effects Tracked |
|---------|------|-----------------|
| **Dreamwalk** | DW:C | Travel through dreams |
| **Dreamwatch** | DW:C | Monitor sleepers |
| **Dreambend** | DW:C | Minor reality alterations |
| **Dreamstep** | DW:C | Short-range teleport |
| **Nightmare** | DW:S | Inflict psychic damage |
| **Dreamshape** | DW:S | Alter dream environment |
| **Dreamfortify** | DW:S | Protection in dreams |
| **Dreamlock** | DW:S | Trap in dreams |
| **Dreamjump** | DW:S | Long-range teleport |
| **Dreamshatter** | DW:S | Destroy dreamscapes |
| **Dreamweave** | DW:S | Create permanent effects |

### The Warder (Fighter Variant)

TGTT's Fighter class variant with focus on stamina and combat traditions.

#### ✅ Core Features

| Feature | Level | Implementation |
|---------|-------|----------------|
| **Combat Traditions** | 1 | Selectable tradition + methods |
| **Stamina Pool** | 1 | Uses per rest resource |
| **Specialties** | 1, 5, 9, 13, 17 | Feature choice selections |
| **Battle Tactics** | Various | See Battle Tactics section |
| **Auto-Grant Traditions** | 3 (Warder) | Tempered Iron + Gallant Heart via `_subclassGrantedTraditions` |

### ✅ Subclass Tradition Auto-Granting (Phase D)

Subclasses that grant combat traditions automatically when selected:

| Subclass | Tradition(s) Granted | Condition |
|----------|---------------------|-----------|
| **Warder** (Fighter) | Tempered Iron, Gallant Heart | TGTT source, level 3+ |
| **Arcane Archer** (Fighter) | Biting Zephyr | TGTT source, level 3+ |
| **Way of Mercy** (Monk) | Sanguine Knot | TGTT source, level 3+ |

Generic `_subclassGrantedTraditions` pattern feeds into `combatTradition` effect type via `_aggregateCalculationBasedEffects()`. Traditions clear/re-apply on class change.

---

## Subclasses

### ✅ Barbarian

| Subclass | Status | Key Features |
|----------|--------|--------------|
| **Chained Fury** | ✅ Complete | `chainWorthyDamageBonus`, `chainWrapDice`, `breakingTheChainsHp`, `explosiveEntranceRange` |

### ✅ Bard Colleges

| College | Status | Key Features |
|---------|--------|--------------|
| **Conduction** | ✅ Complete | `batteryDice`, `amplifiedEffectBonus`, `conductorAuraRange` |
| **Jesters** | ✅ Complete | `jestersActUses`, `jestersGrin` bonuses |
| **Surrealism** | ✅ Complete | `surrealistInspirationDie`, `dreamLogicUses` |

### ✅ Cleric Domains

| Domain | Status | Key Features |
|--------|--------|--------------|
| **Beauty** | ✅ Complete | `beautifySelfUses`, `distractingBeautyDc` |
| **Blood** | ✅ Complete | `bloodChannelDamageDice`, `sanguineRecovery` |
| **Darkness** | ✅ Complete | `darknessChannelRange`, `umbralStrikeDamage` |
| **Lust** | ✅ Complete | `charmingPresenceDc`, `seductiveAuraRange` |
| **Madness** | ✅ Complete | `maddingTouchDamage`, `contagiousMadnessRange` |
| **Time** | ✅ Complete | `temporalShiftUses`, `rewindActionUses`, `hasteSelfDuration` |

### ✅ Ranger Conclaves

| Conclave | Status | Key Features |
|----------|--------|--------------|
| **Primal Focus** | ✅ Complete | `predatorMode` / `preyMode` toggle, mode-specific bonuses |

### ✅ Sorcerer Origins

| Origin | Status | Key Features |
|--------|--------|--------------|
| **Heroic Soul** | ✅ Complete | `heroicMomentUses`, `inspireAllyBonus`, `legendaryResistanceUses` |
| **Fiendish Bloodline** | ✅ Complete | `darkVisionFromFiend`, `fiendishResistance`, `demonic/devilishFormDamage` |
| **Sun Bloodline** | ✅ Complete | L1: `glimpseOfSun`, `summersDefiantBlood`; L6: `sunlitPathRange`; L14: `graspingTheSunDamage`, `graspingTheSunRange`; L18: `brightZenithRadiusFt`, `brightZenithDamage` |

### ✅ Warlock Patrons

| Patron | Status | Key Features |
|--------|--------|--------------|
| **The Horror** | ✅ Complete | `devastatingStrikeDamage` (scales by level), `devastatingStrikeAc` (temporary AC during strike), L6: `fearsomePresenceDc`, `feedOnFearHealing` |

---

## Combat Methods System

The stamina-based combat system is fully implemented.

### ✅ Core Mechanics

| Feature | Implementation |
|---------|----------------|
| **Stamina Pool** | `staminaPool = 2 × proficiency bonus` |
| **Stamina Recovery** | Full on long rest, half (rounded up) on short rest |
| **Method Costs** | 1-3 stamina per method |
| **Method DC** | `8 + proficiency + STR or DEX` |
| **Stance System** | One active stance at a time, stance speed bonus wired into `getSpeedBonusFromStates()` |

### ✅ Combat Traditions (17 total)

All traditions with 5 degrees of methods each:

| Tradition | Code | Theme |
|-----------|------|-------|
| Adamant Mountain | AM | Defensive, strength |
| Arcane Knight | AK | Magic-martial hybrid |
| Beast Unity | BU | Animal companion |
| Biting Zephyr | BZ | Speed, mobility |
| Comedic Jabs | CJ | Distraction, humor |
| Eldritch Blackguard | EB | Dark magic combat |
| Gallant Heart | GH | Protective, noble |
| Mirror's Glint | MG | Deception, illusion |
| Mist and Shade | MS | Stealth, shadow |
| Rapid Current | RC | Flow, adaptation |
| Razor's Edge | RE | Precision, critical |
| Sanguine Knot | SK | Blood magic |
| Spirited Steed | SS | Mounted combat |
| Tempered Iron | TI | Endurance, resilience |
| Tooth and Claw | TC | Natural weapons |
| Unending Wheel | UW | Momentum, chains |
| Unerring Hawk | UH | Ranged, accuracy |
| Ace Starfighter | AS | Space combat variant |

### ✅ Method Effects Tracked

```javascript
// Example method calculation
calculations.combatMethods = {
    traditions: ["AM", "RC"],
    knownMethods: [...],
    activeStance: "Mountain's Base",
    stanceEffects: {
        acBonus: 2,
        movementPenalty: -10,
    },
    methodDc: 15,
}
```

---

## Battle Tactics

### ✅ All 13 Tactics Implemented

| Tactic | Prerequisite | Effect |
|--------|--------------|--------|
| **Blitz** | L5 Martial | +10 ft movement on turn with attack |
| **Cleaving Strike** | L7 Martial | Hit multiple adjacent enemies |
| **Combat Dash** | L5 Martial | Dash as bonus action |
| **Commander's Strike** | L7 Martial | Ally attacks as reaction |
| **Defensive Stance** | L5 Martial | +2 AC, -10 ft movement |
| **Disarming Strike** | L7 Martial | Force enemy to drop weapon |
| **Distracting Strike** | L5 Martial | Ally gains advantage |
| **Flurry** | L5 Martial | Additional attack at -5 |
| **Grappling Strike** | L5 Martial | Free grapple on hit |
| **Lunging Strike** | L5 Martial | +5 ft reach on attack |
| **Menacing Attack** | L7 Martial | Frighten on hit |
| **Power Attack** | L9 Martial | -5 to hit, +10 damage |
| **Trip Attack** | L5 Martial | Knock prone on hit |

---

## Race Features

### ✅ Implemented

| Race | Feature | Implementation |
|------|---------|----------------|
| **Half-Ogre** | Enraged | `enragedCritRange: 19-20`, `enragedUses`, `enragedDurationRounds: 10`, `enragedExhaustionCost: 1`, `enragedEligible` (HP check) |
| **Gnoll** | Thrill of the Hunt | `thrillMarkDuration: "1 minute"`, `thrillMarkRange: 60`, `thrillMarkUses` |
| **Gnoll** | Rampage | `rampageMoveDistance: 15`, `rampageBiteDamage: "1d6"`, `rampageBiteBonus` |
| **Tiefling (Asmodeus)** | Infernal Luck | `infernalLuckUses` |

### ⚠️ Partial/Narrative

| Race | Feature | Status |
|------|---------|--------|
| **Dendulra** | Bubbling Energy | Stub - requires 4-hour rest tracking |
| **Descathi** | Shadow Affinity | Stub - requires hide condition tracking |

---

## Feats

### ✅ Implemented

| Feat | Implementation |
|------|----------------|
| **Lore Mastery** | `loreMasterySkillBonus`, `loreMasteryFields` (chosen lore skills) |
| **Spellsword Technique** | `spellswordTechniqueAc` (+2 when holding melee weapon + arcane focus) |
| **Whip Master** | `whipMasterReachBonus`, `whipMasterDisarmDc` |
| **Dreamer** | Grants 1 Dreamwalker ability (DW:C or DW:S), tracked in `dreamwalkerAbilities` |

### ⚠️ Stub Only

| Feat | Notes |
|------|-------|
| **Spell Scribing Adept** | Narrative feat - reduces scribing costs/time, no direct mechanical calculation |

---

## Metamagic System

The TGTT Sorcerer metamagic supports the full progression and cost model, plus cast-time selection for active metamagics. Runtime automation now covers `Quickened Spell`, `Subtle Spell`, `Bestowed Spell`, `Heightened Spell`, `Seeking Spell`, `Focused Spell`, `Lingering Spell`, `Aimed Spell`, `Overcharged Spell`, and `Vampiric Spell`; `Twinned Spell` and `Bouncing Spell` still need deeper effect automation.

### ✅ Progression

| Level | Known | Source |
|-------|-------|--------|
| 2 | 2 | TGTT/PHB |
| 3 | 3 | TGTT variation |
| 6 | 4 | |
| 10 | 5 | |
| 13 | 6 | |
| 17 | 7 | |

### ✅ Costs & Descriptions

| Metamagic | Cost | Effect |
|-----------|------|--------|
| Careful Spell | 1 | Auto-succeed saves for WIS mod creatures |
| Distant Spell | 1 | Double range / touch → 30 ft |
| Empowered Spell | 1 | Reroll CHA mod damage dice |
| Extended Spell | 1 | Double duration |
| Heightened Spell | 3 | Impose disadvantage on save |
| Quickened Spell | 2 | Bonus action casting |
| Seeking Spell | 2 | Reroll miss, ignore cover |
| Subtle Spell | 1 | No V/S components |
| Transmuted Spell | 1 | Change damage type |
| Twinned Spell | Varies | Target two creatures |
| Aimed Spell | 2 | Add 1d6 to a spell attack roll |
| Bestowed Spell | Varies | Change self-range spell to touch |
| Bouncing Spell | 3 | Bounce on successful save |
| Focused Spell | Varies | Reroll one concentration save die |
| Lingering Spell | Varies | Concentration effects linger briefly after breaking |
| Overcharged Spell | 4 | Maximize spell damage dice |
| Resonant Spell | 2 | Passive: counter/dispel attempts have disadvantage |
| Split Spell | 1 | Passive: split qualifying AoEs between two points |
| Supple Spell | 2 | Passive: resize qualifying AoEs |
| Vampiric Spell | Half spell level | Heal equal to spell damage dealt |
| Warding Spell | 2 | Passive: +1 AC while concentrating |

### Current Automation Status

- Passive metamagic tuning, sorcery-point locking, and history replay are supported.
- Active metamagic cast-time selection, legality checks, and SP spending are supported.
- Automated active effects currently supported: `Quickened Spell`, `Subtle Spell`, `Bestowed Spell`, `Heightened Spell`, `Seeking Spell`, `Focused Spell`, `Lingering Spell`, `Aimed Spell`, `Overcharged Spell`, `Vampiric Spell`.
- Remaining active effects still pending deeper runtime automation: `Twinned Spell`, `Bouncing Spell`.

---

## Conditions

TGTT-specific conditions are auto-registered when Thelemar rules are enabled:

| Condition | Effects |
|-----------|---------|
| **Dazed** | Limited actions |
| **Choked** | Can't speak/breathe |
| **Slowed** | Reduced speed/reactions |
| **Hidden** | TGTT stealth mechanics |
| **Undetected** | Enhanced hidden state |
| **Modified Grappled** | TGTT grapple rules |
| **Modified Restrained** | TGTT restrain rules |
| **Modified Petrified** | TGTT petrify rules |
| **Modified Stunned** | TGTT stun rules |

---

## Deferred / Not Yet Implemented

### Low Priority - Narrative Features

These features have minimal mechanical benefit and are tracked as stubs:

| Feature | Reason |
|---------|--------|
| **Bubbling Energy** (Dendulra) | Requires 4-hour rest interval tracking - narrative flavor |
| **Shadow Affinity** (Descathi) | Requires persistent hide state tracking - mainly narrative |
| **Spell Scribing Adept** | Cost reduction - no direct stat calculation |

### System-Level Requirements

These would require broader system changes:

| Feature | Required System |
|---------|-----------------|
| Mark active state tracking | Global mark/concentration system |
| Spell rarity enforcement | Spell selection filtering in builder |
| Combat method chaining | Real-time combat tracker integration |
| Dream travel tracking | Dreamtime session management |

---

## Testing Coverage

### Test Files

- `CharacterSheetTGTT.test.js` — 737 tests (core TGTT systems)
- `CharacterSheetCombatMethodsSurvey.test.js` — 81 tests (Phase D: tradition parsing, stance integration, subclass tradition grants, edge cases, degree progression, DC calculation, stamina pool)

### Test Categories

| Category | Tests |
|----------|-------|
| Variant Rules | ~50 |
| Dreamwalker Class | ~120 |
| Dreamwalker Abilities | ~80 |
| Combat Methods | ~150 + 81 (survey) |
| Battle Tactics | ~80 |
| Subclasses | ~200 |
| Races | ~40 |
| Feats | ~17 |

### Running Tests

```bash
# All TGTT tests
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetTGTT --no-coverage

# Specific category
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetTGTT --no-coverage \
  --testNamePattern='Dreamwalker'
```

---

## Contributing TGTT Features

### Adding a New Subclass

1. Find the class section in `getFeatureCalculations()` in `charactersheet-state.js`
2. Add a case for the subclass name (case-insensitive)
3. Implement level-gated calculations
4. Add tests in `CharacterSheetTGTT.test.js`

```javascript
case "New Subclass":
case "new subclass": {
    // Level 1 feature
    calculations.hasSubclassFeature = true;
    
    // Level 6 feature
    if (level >= 6) {
        calculations.featureBonus = this.getAbilityMod("cha");
    }
    
    // Level 14 feature
    if (level >= 14) {
        calculations.featureDamage = `${Math.ceil(level / 2)}d6`;
    }
    break;
}
```

### Adding a Race Feature

Race features go in the `TGTT RACE FEATURES` section:

```javascript
// Check race name pattern
if (raceName?.toLowerCase()?.includes("newrace") || 
    fullRaceName?.toLowerCase()?.includes("newrace")) {
    calculations.hasRaceFeature = true;
    calculations.raceFeatureUses = Math.max(1, this.getAbilityMod("con"));
}
```

---

## Version History

| Date | Changes |
|------|---------|
| 2024-02 | Initial TGTT support - variant rules |
| 2024-06 | Combat Methods system |
| 2024-08 | Battle Tactics, Dreamwalker |
| 2024-10 | Subclass audit and fixes |
| 2024-02-13 | Race features, Sun Bloodline L6/14/18, Horror fixes |

---

## Related Documentation

- [Feature Calculations](./05-feature-calculations.md) - How getFeatureCalculations() works
- [Toggle Abilities](./08-toggle-abilities.md) - Combat stances and modes
- [Combat System](./06-combat-system.md) - Stamina and methods
- [Testing Strategy](./09-testing-strategy.md) - Test patterns

