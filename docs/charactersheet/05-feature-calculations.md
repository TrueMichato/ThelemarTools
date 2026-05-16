# Feature Calculations Deep Dive

This document provides comprehensive documentation for `getFeatureCalculations()`, the method that computes all class-specific mechanics.

## Overview

`getFeatureCalculations()` is the most critical method in `CharacterSheetState`. It returns an object containing all computed class features, abilities, and their values based on:

- Current class levels
- Subclass selections
- Source book (PHB 2014 vs XPHB 2024)
- Ability scores
- Proficiency bonus

## Return Value Structure

The method returns a flat object with boolean flags and computed values:

```javascript
const calculations = state.getFeatureCalculations();

// Example return value for a Level 5 Barbarian / Level 3 Rogue
{
    // Barbarian features
    hasRage: true,
    rageDamage: 2,
    ragesPerDay: 3,
    hasDangerSense: true,
    hasExtraAttack: true,
    hasFastMovement: true,
    fastMovementBonus: 10,
    
    // Rogue features
    sneakAttack: {dice: "2d6", avgDamage: 7},
    hasThievesCant: true,
    hasCunningAction: true,
    
    // From subclass...
}
```

## Naming Conventions

| Prefix | Meaning | Example |
|--------|---------|---------|
| `has{Feature}` | Boolean: feature is available | `hasRage`, `hasEvasion` |
| `{feature}Damage` | Damage dice or amount | `rageDamage`, `sneakAttack.dice` |
| `{feature}Dc` | Save DC for the feature | `kiSaveDc`, `maneuverSaveDc` |
| `{feature}Uses` | Number of uses per rest | `ragesPerDay`, `actionSurgeUses` |
| `{feature}Bonus` | Numeric bonus provided | `initiativeBonus`, `acBonus` |
| `{feature}Range` | Range in feet | `auraRange`, `shadowStepRange` |

## Class Feature Breakdowns

### Barbarian

```javascript
// Core features (all sources)
hasRage: true,                    // Level 1+
rageDamage: 2 | 3 | 4,           // +2 (L1-8), +3 (L9-15), +4 (L16+)
ragesPerDay: 2-6 | Infinity,     // Scales with level

hasDangerSense: true,             // Level 2+
hasExtraAttack: true,             // Level 5+
hasFastMovement: true,            // Level 5+
fastMovementBonus: 10,            // +10 ft when not in heavy armor

hasFeralInstinct: true,           // Level 7+ - advantage on initiative
hasRelentlessRage: true,          // Level 11+ 
relentlessRageBaseDc: 10,         // DC increases by 5 each use

hasPersistentRage: true,          // Level 15+ - rage doesn't end early
hasIndomitableMight: true,        // Level 18+ - STR check min = STR score
hasPrimalChampion: true,          // Level 20+ - +4 STR/CON (max 24)

// PHB-only
brutalCritical: "+1 dice" | "+2 dice" | "+3 dice",  // L9/L13/L17

// XPHB-only
brutalStrikeDamage: "1d10" | "2d10",  // L9/L17
weaponMasterySlots: 2 | 3 | 4,        // L1/L4/L10
```

#### Barbarian Subclasses

**Path of the Berserker**
```javascript
hasFrenzy: true,                  // Level 3+
hasMindlessRage: true,            // Level 6+
hasIntimidatingPresence: true,    // Level 10 (PHB) or 14 (XPHB)
intimidatingPresenceDc: number,
hasRetaliation: true,             // Level 14 (PHB) or 10 (XPHB)
```

**Path of the Totem Warrior**
```javascript
hasSpiritSeeker: true,            // Level 3+
hasTotemSpirit: true,             // Level 3+
hasAspectOfBeast: true,           // Level 6+
hasSpiritWalker: true,            // Level 10+
hasTotemicAttunement: true,       // Level 14+
```

**Path of the Zealot**
```javascript
hasDivineFury: true,
divineFuryDamage: "1d6+{level/2}",
hasWarriorOfTheGods: true,
hasFanaticalFocus: true,          // Level 6+
hasZealousPresence: true,         // Level 10+
hasRageBeyondDeath: true,         // Level 14+
```

### Fighter

```javascript
// Core features
secondWindHealing: "1d10+{level}",
secondWindUses: 1 | 2-5,          // PHB: 1, XPHB: scales

actionSurgeUses: 1 | 2,           // 1 (L2-16), 2 (L17+)

hasExtraAttack: true,             // Level 5+
extraAttacks: 2 | 3 | 4,          // L5: 2 attacks, L11: 3, L20: 4

indomitableUses: 1 | 2 | 3,       // L9: 1, L13: 2, L17: 3

// XPHB-only
hasTacticalMind: true,            // Level 2+
hasTacticalShift: true,           // Level 5+
hasTacticalMaster: true,          // Level 9+
hasStudiedAttacks: true,          // Level 13+
```

#### Fighter Subclasses

**Champion**
```javascript
improvedCriticalRange: 19 | 18,   // L3: 19-20, L15: 18-20
hasRemarkableAthlete: true,       // Level 7+
remarkableAthleteBonus: number,
hasAdditionalFightingStyle: true, // Level 10+
hasSurvivor: true,                // Level 18+
survivorHealing: "5+CON",
```

**Battle Master**
```javascript
superiorityDice: 4 | 5 | 6,       // L3: 4, L7: 5, L15: 6
superiorityDieSize: "d8" | "d10" | "d12",  // L3: d8, L10: d10, L18: d12
maneuverSaveDc: 8 + profBonus + STR|DEX,
maneuversKnown: 3 | 5 | 7 | 9,    // Scales with level
hasStudentOfWar: true,            // Level 3+
hasKnowYourEnemy: true,           // Level 7+ (PHB) or 9+ (XPHB)
hasRelentless: true,              // Level 15+
```

**Eldritch Knight**
```javascript
hasSpellcasting: true,
spellcastingAbility: "int",
spellSaveDc: 8 + profBonus + INT,
spellAttackBonus: profBonus + INT,
cantripsKnown: 2 | 3,             // L3: 2, L10: 3
spellsKnown: 3-13,                // Scales with level
hasWarMagic: true,                // Level 7+
hasEldritchStrike: true,          // Level 10+
hasArcaneCharge: true,            // Level 15+
hasImprovedWarMagic: true,        // Level 18+
```

### Rogue

```javascript
// Core features
sneakAttack: {
    dice: "{ceil(level/2)}d6",
    avgDamage: number,
},

hasThievesCant: true,             // Level 1+
hasExpertise: true,               // Level 1+
expertiseSkills: 2 | 4,           // L1: 2, L6: 4

hasCunningAction: true,           // Level 2+
hasUncannyDodge: true,            // Level 5+
hasEvasion: true,                 // Level 7+

hasReliableTalent: true,          // L11 (PHB) or L7 (XPHB)
reliableTalentMinimum: 10,

hasSlipperyMind: true,            // Level 15+
hasElusive: true,                 // Level 18+
hasStrokeOfLuck: true,            // Level 20+

// XPHB-only
hasCunningStrike: true,           // Level 5+
cunningStrikeOptions: ["Poison", "Trip", "Withdraw"],
hasDeviousStrikes: true,          // Level 14+
```

#### Rogue Subclasses

**Assassin**
```javascript
hasAssassinate: true,
hasInfiltrationExpertise: true,   // Level 9+
hasImpostor: true,                // Level 13+ (PHB)
hasEnvenomWeapons: true,          // Level 13+ (XPHB)
envenomDamage: "{profBonus}d6",
hasDeathStrike: true,             // Level 17+
deathStrikeDc: 8 + profBonus + DEX,
```

**Arcane Trickster**
```javascript
hasSpellcasting: true,
spellcastingAbility: "int",
spellSaveDc: 8 + profBonus + INT,
spellAttackBonus: profBonus + INT,
hasMageHandLegerdemain: true,
hasMagicalAmbush: true,           // Level 9+
hasVersatileTrickster: true,      // Level 13+
hasSpellThief: true,              // Level 17+
```

**Soulknife**
```javascript
hasPsionicPower: true,
psionicEnergyDice: profBonus * 2,
psionicEnergyDie: "d6" | "d8" | "d10" | "d12",
hasPsychicBlades: true,
psychicBladeDamage: "1d6",
psychicBladeOffhand: "1d4",
hasSoulBlades: true,              // Level 9+
hasPsychicVeil: true,             // Level 13+
hasRendMind: true,                // Level 17+
rendMindDc: 8 + profBonus + DEX,
```

### Monk

```javascript
// Core features
kiPoints: level,                  // = monk level
focusPoints: level,               // XPHB name

kiSaveDc: 8 + profBonus + WIS,
focusSaveDc: 8 + profBonus + WIS,

martialArtsDie: "1d4"-"1d12",     // Scales with level
unarmedDamage: "{martialArtsDie}",

unarmoredMovement: 10-30,         // +10 at L2, scales

deflectMissilesReduction: "1d10+DEX+level",

hasExtraAttack: true,             // Level 5+
hasStunningStrike: true,          // Level 5+
hasEvasion: true,                 // Level 7+

slowFallReduction: level * 5,     // Level 4+

// PHB-specific
hasDiamondSoul: true,             // Level 14+
hasEmptyBody: true,               // Level 18+
emptyBodyCost: 4,

// XPHB-specific
hasDisciplinedSurvivor: true,     // Level 14+
hasSuperiorDefense: true,         // Level 18+
superiorDefenseCost: 3,
```

### Paladin

```javascript
// Core features
layOnHandsPool: level * 5,

hasSpellcasting: true,            // L2+ (PHB), L1+ (XPHB)
spellSaveDc: 8 + profBonus + CHA,
spellAttackBonus: profBonus + CHA,

hasDivineSmite: true,             // Level 2+
smiteBaseDamage: "2d8",
smiteMaxDamage: "5d8",

channelDivinityUses: 1 | 2 | 3,   // PHB: 1, XPHB: 2 (L3), 3 (L11)

hasExtraAttack: true,             // Level 5+

hasAuraOfProtection: true,        // Level 6+
auraOfProtectionBonus: max(0, CHA),
auraRange: 10 | 30,               // 10 (L6), 30 (L18)

hasAuraOfCourage: true,           // Level 10+

// PHB: Improved Divine Smite (L11)
hasImprovedDivineSmite: true,
improvedSmiteDamage: "1d8",

// XPHB: Radiant Strikes (L11)
hasRadiantStrikes: true,
radiantStrikesDamage: "1d8",
```

### Wizard

```javascript
hasSpellcasting: true,
spellcastingAbility: "int",
spellSaveDc: 8 + profBonus + INT,
spellAttackBonus: profBonus + INT,

hasArcaneRecovery: true,
arcaneRecoverySlots: ceil(level / 2),

hasSpellMastery: true,            // Level 18+
hasSignatureSpells: true,         // Level 20+
```

#### Wizard Subclasses

**School of Evocation**
```javascript
hasSculptSpells: true,            // Level 2+
hasPotentCantrip: true,           // Level 6+
hasEmpoweredEvocation: true,      // Level 10+
empoweredEvocationBonus: INT,
hasOverchannel: true,             // Level 14+
```

**Bladesinging**
```javascript
hasBladesong: true,               // Level 2+
bladesongUses: profBonus,
bladesongAcBonus: max(1, INT),
bladesongConcentrationBonus: max(1, INT),
bladesongSpeedBonus: 10,
hasExtraAttack: true,             // Level 6+
hasSongOfDefense: true,           // Level 10+
hasSongOfVictory: true,           // Level 14+
songOfVictoryDamage: INT,
```

### Warlock

```javascript
hasSpellcasting: true,
spellcastingAbility: "cha",
spellSaveDc: 8 + profBonus + CHA,
spellAttackBonus: profBonus + CHA,

pactSlotLevel: 1-5,               // Scales with level
pactSlotCount: 1-4,               // L1: 1, L2: 2, L11: 3, L17: 4

cantripsKnown: 2-5,               // Scales with level
spellsKnown: 2-15,                // Scales with level

eldritchInvocationsKnown: 0-8,    // L2: 2, scales

hasMysticArcanum: true,           // Level 11+ (6th level spell)
// Additional arcanums at 13 (7th), 15 (8th), 17 (9th)
```

### Bard

```javascript
hasSpellcasting: true,
spellcastingAbility: "cha",
spellSaveDc: 8 + profBonus + CHA,
spellAttackBonus: profBonus + CHA,

bardicInspirationDie: "d6"-"d12",
bardicInspirationUses: max(1, CHA) | profBonus,  // PHB: CHA, XPHB: profBonus

hasJackOfAllTrades: true,         // Level 2+
jackOfAllTradesBonus: floor(profBonus / 2),

hasSongOfRest: true,              // Level 2+
songOfRestDie: "d6"-"d12",

hasExpertise: true,               // Level 3+

hasCountercharm: true,            // Level 6+ (PHB) / different in XPHB
hasMagicalSecrets: true,          // Level 10+
hasSuperiorInspiration: true,     // Level 20+
```

### Cleric

```javascript
hasSpellcasting: true,
spellcastingAbility: "wis",
spellSaveDc: 8 + profBonus + WIS,
spellAttackBonus: profBonus + WIS,

hasChannelDivinity: true,         // Level 2+
channelDivinityUses: 1 | 2 | 3,   // L2: 1, L6: 2, L18: 3

hasDivineIntervention: true,      // Level 10+
divineInterventionChance: level,  // % chance (PHB)

hasDestroyUndead: true,           // Level 5+
destroyUndeadCr: 0.5 | 1 | 2 | 3 | 4,  // Scales
```

### Druid

```javascript
hasSpellcasting: true,
spellcastingAbility: "wis",
spellSaveDc: 8 + profBonus + WIS,
spellAttackBonus: profBonus + WIS,

hasWildShape: true,               // Level 2+
wildShapeUses: 2 | profBonus,     // PHB: 2, XPHB: profBonus
wildShapeMaxCr: "1/4" | "1/2" | "1", // Scales

// Moon Druid
hasCombatWildShape: true,
circleForms: true,                // Higher CR earlier
```

### Sorcerer

```javascript
hasSpellcasting: true,
spellcastingAbility: "cha",
spellSaveDc: 8 + profBonus + CHA,
spellAttackBonus: profBonus + CHA,

sorceryPoints: level,             // = sorcerer level
hasMetamagic: true,               // Level 3+
metamagicKnown: 2 | 3 | 4,        // L3: 2, L10: 3, L17: 4

hasSorcerousRestoration: true,    // Level 20+
```

### Ranger

```javascript
hasSpellcasting: true,            // Level 2+
spellcastingAbility: "wis",
spellSaveDc: 8 + profBonus + WIS,
spellAttackBonus: profBonus + WIS,

hasFavoredEnemy: true,            // Level 1+ (varies by edition)
hasNaturalExplorer: true,         // Level 1+ (PHB)
hasDeftExplorer: true,            // Level 1+ (TCE/XPHB)

hasPrimevalAwareness: true,       // Level 3+ (PHB)
hasPrimalAwareness: true,         // Level 3+ (TCE/XPHB)

hasExtraAttack: true,             // Level 5+
hasLandStride: true,              // Level 8+
hasVanish: true,                  // Level 14+
hasFoeSlayer: true,               // Level 20+
```

### Artificer

```javascript
hasSpellcasting: true,
spellcastingAbility: "int",
spellSaveDc: 8 + profBonus + INT,
spellAttackBonus: profBonus + INT,

hasInfusions: true,               // Level 2+
infusionsKnown: 4 | 6 | 8 | 10 | 12,
infusedItemsMax: 2 | 3 | 4 | 5 | 6,

hasToolExpertise: true,           // Level 6+
hasFlashOfGenius: true,           // Level 7+
flashOfGeniusBonus: INT,
flashOfGeniusUses: INT,

hasMagicItemAdept: true,          // Level 10+
hasMagicItemSavant: true,         // Level 14+
hasMagicItemMaster: true,         // Level 18+
hasSoulOfArtifice: true,          // Level 20+
```

---

## Usage in UI Components

### Displaying Features

```javascript
const calc = state.getFeatureCalculations();

// Check if character has a feature
if (calc.hasRage) {
    this._renderRageSection(calc.rageDamage, calc.ragesPerDay);
}

// Display computed values
if (calc.sneakAttack) {
    $(`#sneak-attack-dice`).text(calc.sneakAttack.dice);
    $(`#sneak-attack-avg`).text(calc.sneakAttack.avgDamage);
}

// Conditional rendering based on subclass
if (calc.hasBladesong) {
    this._renderBladesongControls({
        uses: calc.bladesongUses,
        acBonus: calc.bladesongAcBonus,
        speedBonus: calc.bladesongSpeedBonus,
    });
}
```

### Combat Calculations

```javascript
const calc = state.getFeatureCalculations();

// Apply rage damage
if (state.isStateTypeActive("rage") && calc.rageDamage) {
    baseDamage += calc.rageDamage;
}

// Check for improved critical
if (calc.improvedCriticalRange) {
    critRange = calc.improvedCriticalRange;  // 19 or 18
}

// Extra attacks
const attackCount = calc.extraAttacks || 1;
```

### Feature Usage Tracking

```javascript
const calc = state.getFeatureCalculations();

// Track limited uses
const rageTracker = {
    max: calc.ragesPerDay === Infinity ? "∞" : calc.ragesPerDay,
    current: state.getResourceCurrent("rage"),
    recharge: "long",
};

// Superiority dice
if (calc.superiorityDice) {
    const sdTracker = {
        max: calc.superiorityDice,
        dieSize: calc.superiorityDieSize,
        current: state.getResourceCurrent("superiority"),
        recharge: "short",
    };
}
```

---

## Performance Considerations

`getFeatureCalculations()` is called frequently. Consider:

1. **Caching**: Results can be cached until class/level changes
2. **Lazy Evaluation**: Only compute what's needed
3. **Memoization**: Store computed proficiency bonus

```javascript
// Example caching pattern
_cachedCalculations = null;
_calculationsCacheKey = null;

getFeatureCalculations() {
    const cacheKey = this._getCalculationsCacheKey();
    if (this._cachedCalculations && this._calculationsCacheKey === cacheKey) {
        return this._cachedCalculations;
    }
    
    this._cachedCalculations = this._computeFeatureCalculations();
    this._calculationsCacheKey = cacheKey;
    return this._cachedCalculations;
}

_getCalculationsCacheKey() {
    // Include anything that affects calculations
    return JSON.stringify({
        classes: this._data.classes,
        abilityScores: this._data.abilityScores,
    });
}
```

---

## Conditional Modifier Encoding

Some features grant advantage / disadvantage / a bonus **only under a condition** — Dauntless Heritage ("on saves against being frightened"), Stout Resilience ("against poison"), etc. These come in two equivalent encodings that both flow through the same gating + picker pipeline.

### Encoding 1 — Text-parsed conditional

```javascript
{
    type: "save:all",
    advantage: true,
    conditional: "against being frightened",  // <-- free text
    name: "Dauntless Heritage",
}
```

### Encoding 2 — Registry sub-typed conditional

```javascript
{
    type: "save:advantage:frightened",  // sub-type after the 2nd colon
    name: "Dauntless Heritage",
}
```

The sub-type slot accepts conditions (`frightened`, `poisoned`, …), damage types (`fire`, `psychic`, …), and the special keywords `magic`, `disease`, `spells`. It does **not** accept ability codes (`str`/`dex`/…) or `all` — those are non-conditional and applied automatically.

### Normalization

`getModifiersForType()` synthesizes a `conditional` text field on registry sub-typed entries when queried via the base type (e.g. `save:dex`), so both encodings appear identically to the aggregator. The picker dedupes on `_buildConditionalModId(mod)` = `${baseType}|${name||note||""}|${conditional}`.

### Static helpers

| Helper | Purpose |
|---|---|
| `_isConditionalSaveSubtype(subtype)` | Distinguishes conditional sub-types (`frightened`, `fire`, `magic`, …) from non-conditional ones (ability codes, `all`, standard skills) |
| `_buildConditionalModId(mod)` | Deterministic ID for picker dedup; strips `:advantage:` / `:disadvantage:` from base type |

See [State Management → Modifier Aggregation API](./04-state-management.md#modifier-aggregation-api) for `aggregateModifiers` opt forwarding and the `conditionalsAvailable` return field.

---

*Previous: [State Management](./04-state-management.md) | Next: [Combat System](./06-combat-system.md)*
