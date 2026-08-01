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

### Talent (TalPsi)

The MCDM Talent is a full homebrew base class with no spellcasting; its
resource economy is **psionic strain** (see
[17-talent-psionics.md](17-talent-psionics.md)).

```javascript
manifestationAbility: "int",
manifestationDie: "1d4" | "1d6" | "1d8",   // L1-4 / L5-12 / L13-20
maxPowerOrder: 2 | 3 | 4 | 5 | 6,          // L1 / L5 / L9 / L13 / L17
firstOrderPowersKnown: 4 | 5 | 6,          // L1 / L4 / L10
higherOrderPowersKnown: level + 1,
strainMaximum: 4 + talentLevel,
powerSaveDc: 8 + proficiency + INT modifier,
powerAttackBonus: proficiency + INT modifier,
psionicExertionsKnown: 1 | 2 | 3 | 4,      // L3 / L7 / L11 / L15
psychicBoostUses: 1 | 2 | 3,               // L7 / L12 / L17
hasPsionicBastion: true,                   // L11
hasShieldedMind: true,                     // L18
hasIgnoreStrain: true,                     // L20
```

Chronopath adds `chronopathyAdeptUses` / `rapidManifestationUses` (INT modifier,
minimum 1), `decayDamagePerStrain` (`2d10`), `decayDc`, `hasFickleReadiness`,
and `timePocketDamage` / `timePocketDc`.

Both power pools and the Psionic Exertion list are surfaced through the
**generic optional-feature progression** machinery, so Builder, Level-Up and
Quick Build all present the picks with no per-class UI.

### Blood Hunter (BH2022)

```javascript
hemocraftAbility: "int" | "wis",       // Persisted Hunter's Bane choice
hemocraftDie: "1d4" | "1d6" | "1d8" | "1d10",
hemocraftSaveDc: 8 + proficiency + hemocraft ability modifier,
bloodMaledictUses: 1 | 2 | 3 | 4,     // Short-rest resource
bloodCursesKnown: 1 | 2 | 3 | 4 | 5,
crimsonRitesKnown: 1 | 2 | 3,
crimsonRiteDamage: hemocraftDie,
brandDamage: hemocraft modifier,       // Doubled by Brand of Tethering
darkAugmentationSaveBonus: hemocraft modifier,
darkAugmentationSpeedBonus: 5,
```

Order of the Lycan adds `hybridTransformationUses`, `hybridAttackBonus`,
`hybridDamageBonus`, `hybridNaturalWeaponDamage`, `hybridRegeneration`, and
Stalker's Prowess movement/jump bonuses.
Hybrid Transformation and Crimson Rite are active states; their current effects
are therefore read from state, not permanently folded into the calculation object.
For legacy saves without a recorded Hunter's Bane choice, Hemocraft falls back
to the higher Intelligence/Wisdom modifier.

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

**Champion** (guarded by `level >= 3`, the level the subclass is actually granted)
```javascript
// Shared by PHB and XPHB — Improved Critical (L3) / Superior Critical (L15)
criticalRange: 19 | 18,             // L3: 19-20, L15: 18-20 (weapon/Unarmed
                                     // Strike attacks only — never spell attacks)
hasCriticalRange: true,
hasSuperiorCritical: true,          // Level 15+

// PHB Champion
remarkableAthleteBonus: number,     // L7+: half proficiency (round up) added
                                     // to unproficient STR/DEX/CON checks
hasAdditionalFightingStyle: true,   // L10+ (PHB level gate)
survivorHealing: "5+CON",           // L18+: heal at start of turn while at
                                     // half HP or less (not while at 0 HP);
                                     // no Defy Death advantage in PHB

// XPHB Champion — level gates differ from PHB
hasRemarkableAthlete: true,         // L3+ (XPHB — NOT L7; advantage on
                                     // Initiative + Athletics checks, plus a
                                     // post-crit "move up to half Speed
                                     // without opportunity attacks" affordance
                                     // surfaced by the `championRemarkableAthleteMove`
                                     // post-attack hook in combat.js)
hasAdditionalFightingStyle: true,   // L7+ (XPHB — a 2nd Fighting Style pick,
                                     // via the shared subclass `featProgression`
                                     // path, NOT L10)
hasHeroicWarrior: true,             // L10+ (XPHB — grants Heroic Inspiration
                                     // at the start of a combat turn if absent;
                                     // driven by the generic turn-start
                                     // resolver, see below)
hasChampionSurvivor: true,          // L18+
hasChampionSurvivorDefyDeath: true, // Advantage on death saves; a death-save
                                     // roll of 18-20 gets the natural-20 benefit
championSurvivorDeathSaveNatRange: 18,
championSurvivorHealing: 5 + conMod, // Heroic Rally: heal at start of each
                                     // turn while Bloodied (HP <= half max)
                                     // and alive (HP >= 1), capped at max
```

The critical-hit range (`criticalRange`) is scoped to **weapon and Unarmed
Strike attacks only** — it does not widen spell-attack crit ranges. See
`getCriticalRange(kind)` on `CharacterSheetState`, called from both
`charactersheet-combat.js` (weapon/unarmed attacks, default `kind: "weapon"`)
and `charactersheet-spells.js` (`kind: "spell"`), so a single shared method
scopes the effect rather than each renderer re-deriving it.

**Generic "start of combat turn" resolver** — `getTurnStartEffects()` (pure,
declarative: derives WHAT should happen from `getFeatureCalculations()`) and
`applyTurnStartEffects()` (resolves HOW: grants Inspiration, heals via the
existing `heal()` capped-at-max path) on `CharacterSheetState`, called from
both `startCombat()` (first turn) and `advanceRound()` (every subsequent
turn) in `charactersheet-combat.js`, alongside the pre-existing
`applyHybridRegenerationAtTurnStart()` call. A class-agnostic hook other
subclasses can register against by adding a `calc.hasXyz` flag and a branch
in `getTurnStartEffects()` — no per-class turn-start UI needs to be
hand-rolled elsewhere. Champion's Heroic Warrior (L10 XPHB) and Survivor's
Heroic Rally (L18 XPHB) are both implemented purely as declarative entries
this resolver interprets. `applyTurnStartEffects()` returns the effects it
applied (e.g. `[{type: "grantInspiration", source: "Heroic Warrior"}, {type: "heal", amount: 6, source: "Heroic Rally"}]`);
`getLastTurnStartEffects()` exposes the same list afterward (non-persisted)
for UI toasts.

**Battle Master**
```javascript
superiorityDice: 4 | 5 | 6,       // L3: 4, L7: 5, L15: 6
superiorityDie: "d8" | "d10" | "d12",  // L3: d8, L10: d10, L18: d12
maneuverSaveDcStr: 8 + profBonus + STR,
maneuverSaveDcDex: 8 + profBonus + DEX,
maneuverSaveDc: Math.max(maneuverSaveDcStr, maneuverSaveDcDex), // display fallback
maneuversKnown: 3 | 5 | 7 | 9,    // Scales with level
hasStudentOfWar: true,            // Level 3+
hasKnowYourEnemy: true,            // Level 7+
hasRelentless: true,              // Level 15+
```

XPHB maneuver picks use the generic optional-feature progression and can
replace one known maneuver at each maneuver-gain level. Each selected maneuver
is rendered as a usable ability linked to the persistent **Superiority Dice**
short-rest pool. Save maneuvers prompt for Strength or Dexterity on every use;
attack riders are bound to one attack and double their die on a critical hit,
Precision Attack adjusts the latest attack, and Rally surfaces the ally's
temporary HP result. XPHB Relentless supplies one free d8 maneuver per turn
rather than restoring a die on initiative.

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

**Meteor Knight** (`GriffonsSaddlebag3`)

Source-gated on `CharacterSheetState.isMeteorKnightSubclass()`. Every feature is
a fixed grant — the subclass carries **no player choices**, so Builder /
Level-Up / Quick Build have nothing extra to surface.

```javascript
hasMeteorKnight: true,                              // Level 3+
hasSatelliteMastery: true,                          // Level 3+
satelliteMax: profBonus,                            // bindable satellites
satelliteDamage: "1d4" | "1d6" | "1d8",             // L3 / L10 / L18
satelliteRange: 30 | 60,                            // L3 / L10
satelliteAbility: "int",                            // NOT Strength or Dexterity
satelliteAttackBonus: profBonus + INT,
satelliteDamageBonus: INT,
satelliteIgnoresCloseQuartersDisadvantage: true,
satelliteRecallRange: 120,
hasReduceGravity: true,                             // Level 3+
reduceGravitySpells: ["Feather Fall", "Jump", …],   // + Levitate at 10
reduceGravityAtWillSpells: ["Feather Fall", "Jump"],// Level 15+
hasCourseCorrect: true,                             // Level 7+
courseCorrectCheckBonus: INT + profBonus,           // contest adds PB explicitly
courseCorrectRange: 10,
hasImprovedSatelliteMastery: true,                  // Level 10+
satelliteReturnsOnMiss: true,
satelliteRecallOnActionSurge: true,
hasIncreaseGravity: true,                           // Level 15+
increaseGravityShoveBonus: INT,
hasSatelliteBarrage: true,                          // Level 18+
satelliteBarrageMaxAttacks: satellitesOrbiting,
```

The satellite is a real, rollable attack — `grantedAttacks` receives an
Intelligence-keyed ranged **spell** attack (`isSpellAttack: true`,
`actionType: "bonus"`, `ignoresCloseQuartersDisadvantage: true`) so it appears
in the attack list and rolls like any other. Orbiting satellites live in a
reconciled **"Satellites"** resource pool
(`resourceType: "meteorKnightSatellites"`, max = proficiency bonus) driven by
`bindSatellite()` / `fireSatellite()` / `recallSatellites()`;
`useActionSurge()` calls `recallSatellites()` from level 10.

Increase Gravity is encoded as *conditional* modifiers rather than flat ones —
advantage on `check:advantage:forcedmovement` / `save:advantage:forcedmovement`
plus `skill:athletics +INT` gated on "when you shove a creature" — so the
bonuses are offered per roll instead of leaking onto unrelated Athletics
checks. Note the pre-existing generic gap recorded under CS-BUG-065: opting a
*numeric* conditional in does not currently move a skill or save roll total,
because `_rollSkillCheck` / `_rollSavingThrow` never consume
`aggregated.bonus`. The advantage half works; the +INT is offered and
displayed but not yet summed by those two handlers.

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

// Sun Soul (XGE)
hasRadiantSunBolt: true,           // Subclass level 3+
radiantSunBoltDamage: martialArtsDie,
radiantSunBoltAttackBonus: profBonus + DEX,
radiantSunBoltDamageBonus: DEX,
grantedAttacks: [{                 // Canonical Combat-tab attack descriptor
    name: "Radiant Sun Bolt",
    abilityMod: "dex",
    damage: martialArtsDie,
    damageType: "radiant",
    range: "30 ft.",
}],
searingArcStrikeMaxCost: floor(level / 2), // Level 6+
searingArcStrikeDc: kiSaveDc,
searingSunburstDc: kiSaveDc,       // Level 11+
searingSunburstMaxCost: 3,
sunShieldDamage: 5 + WIS,          // Level 17+
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

// Oath of the Crown (SCAG)
hasChampionChallenge: true,       // L3
championChallengeDc: 8 + profBonus + CHA,
hasTurnTheTide: true,             // L3
turnTheTideHealing: "1d6+CHA",
hasDivineAllegiance: true,        // L7
hasUnyieldingSpirit: true,        // L15
hasExaltedChampion: true,         // L20
```

**Crown is worth reading as a worked example** of the "a calculation is not a
mechanic" rule. Every flag above existed before the subclass was supported, and
the sheet still did nothing: the challenge forced no save, the tide healed
nothing, Divine Allegiance had no way to move damage, Unyielding Spirit
registered no modifier, and Exalted Champion's resistances were inert. See
CS-BUG-050 through CS-BUG-054 in `known-bugs.md` — each was a generic defect on
a shared path, not a Crown-specific gap. Adding a `has*` flag is the *first*
step of supporting a feature, never the last.

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

**School of Necromancy** (PHB L2 / XPHB L3; alias `Necromancer`)
```javascript
hasNecromancySavant: true,        // Level 2/3+ — halves spellbook scribe cost
                                  //   for Necromancy spells (see below)
hasGrimHarvest: true,             // Level 2/3+
grimHarvestMultiplier: 2,         // HP regained = 2 × spell level on a kill
grimHarvestNecromancyMultiplier: 3, //  …3 × if the killing spell is Necromancy

hasUndeadThralls: true,           // Level 6+
undeadThrallsHpBonus: wizardLevel,
undeadThrallsDamageBonus: profBonus,
createdUndeadHpBonus: wizardLevel,   // generic companion-buff bundle
createdUndeadDamageBonus: profBonus,
createdUndeadExtraTargets: 1,
grantedSpellbookSpells: [{name: "Animate Dead", source: "PHB", …}],

hasInuredToUndeath: true,         // Level 10+ (registry: necrotic resistance
                                  //   + hpMaxReductionImmunity)

hasCommandUndead: true,           // Level 14+
commandUndeadDc: spellSaveDc,
commandUndeadRange: 60,
commandUndeadSaveAbility: "cha",
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

// PHB Tempest Domain
hasWrathOfTheStorm: true,         // L1; WIS-mod reaction uses, long rest
hasDestructiveWrath: true,        // L2; deferred lightning/thunder maximization
hasThunderboltStrike: true,       // L6; optional 10-foot push on lightning damage
divineStrikeDamage: "1d8" | "2d8", // L8/L14 thunder weapon rider
hasStormborn: true,               // L17; fly speed equals walking speed
```

Destructive Wrath uses the shared deferred-damage path: activation arms the effect without
spending Channel Divinity, and the next eligible lightning or thunder roll consumes the pool
and maximizes every die. Lightning damage resolution also emits Thunderbolt Strike's optional
target-facing forced-movement result. Wrath of the Storm's per-use lightning/thunder choice is
parsed into the combat action rather than stored as a permanent character choice.

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

sorceryPoints: <see below>,       // single source of truth
hasMetamagic: true,               // Level 3+
metamagicKnown: 2 | 3 | 4,        // L3: 2, L10: 3, L17: 4

hasSorcerousRestoration: true,    // Level 20+
```

**Sorcery Points have exactly one formula**, `static
CharacterSheetState.getSorceryPointsMaxForClass(cls)`:

| Source | Max | First level |
|---|---|---|
| PHB / XPHB | `level` | 2 (Font of Magic) |
| TGTT (Thelemar) | `level + 1` | 1 |

Three surfaces read it and none of them re-derive it:
`getFeatureCalculations()`, `CharacterSheetClassUtils.CLASS_RESOURCES`
(Builder / Level-Up / Quick Build), and `_ensureSorceryPoints()` in the
`getResources()` ensure-chain. Before CS-BUG-080 there were three
formulas, two of which disagreed (CS-BUG-084), and no ensure-hook at all —
so an imported or hand-built Sorcerer had **no pool**, and every
`consumes: {name: "Sorcery Point"}` feature was dead.

`_ensureSorceryPoints()` is **create-only** on purpose. `setSorceryPoints()`
and the TGTT `tuneMetamagic()` / `detuneMetamagic()` pair both mutate
`resource.max` in place — tuning *locks* points by lowering the max — so a
reconciling ensure-hook would untune every metamagic the moment anything
called `getResources()`. Re-scaling on level-up belongs to
`updateClassResources()`.

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

---

## Generic Engine Mechanisms

These are **class-agnostic** primitives. A subclass opts in by setting a
calculation field or registering a `FeatureEffectRegistry` entry; the engine
does the rest. Prefer extending one of these over adding a per-subclass branch.

### `hpMaxReductionImmunity` — effect type

A `FeatureEffectRegistry` effect that makes the character immune to hit-point
**maximum** reduction (Inured to Undeath, Death Ward-style protections, …).

```javascript
FeatureEffectRegistry.register("Inured to Undeath", [
    {type: "resistance", damageType: "necrotic"},
    {type: "hpMaxReductionImmunity"},
]);
```

The configured reduction is **retained, not erased** — it simply stops being
applied, so removing the immunity restores the old behaviour.

| API | Returns |
|---|---|
| `getMaxHpReduction()` | `0` while immune, otherwise the configured value |
| `getConfiguredMaxHpReduction()` | Always the raw configured value |
| `isImmuneToMaxHpReduction()` | `true`/`false` |
| `getMaxHpReductionImmunitySources()` | Feature names granting the immunity |

`getHpBreakdown().maxHpReduction` gains `isImmune`, `immunitySources` and
`ignored` alongside the existing `configured` / `appliedReduction`.

### `spellbookScribeDiscounts` — calculation array

Any feature can push `{school, multiplier, source}` onto
`calculations.spellbookScribeDiscounts`. `getSpellbookScribeCost(spell)` starts
from the 50 gp / 2 hr-per-level baseline and multiplies every matching entry
(clamped to 0–1):

```javascript
state.getSpellbookScribeCost({level: 3, school: "N"});
// → {gp: 75, hours: 3, baseGp: 150, baseHours: 6,
//    multiplier: 0.5, sources: ["Necromancy Savant"]}
```

All **eight** Wizard `<School> Savant` traditions are wired through a single
loop over `CharacterSheetState.WIZARD_SAVANT_SCHOOLS`, so Abjuration Savant,
Evocation Savant etc. get the discount for free. The spell-add flow surfaces the
cost as a toast with a working "Pay N gp" button.

### `grantedSpellbookSpells` — calculation array

A feature can push `{name, source, sourceFeature}` to grant a spell **into the
spellbook** (learnable/castable, but not auto-prepared). Handled by
`populateFeatureGrantedSpellbookSpells()`, which mirrors `populateClassSpells()`
and prunes only its own grants when the feature goes away. Used by Undead
Thralls to grant `animate dead`.

### `createdUndead*` — companion buff bundle

Features that improve creatures the character summons/animates set:

| Calculation | Effect |
|---|---|
| `createdUndeadHpBonus` | HP added to each created undead |
| `createdUndeadDamageBonus` | Weapon-damage bonus on each of its attacks |
| `createdUndeadExtraTargets` | Extra creatures the raising spell affects |
| `createdUndeadBonusSources` | Feature names, for display |

`getCreatedUndeadBonuses()` returns the resolved bundle;
`applyCreatedUndeadBonuses(companionId)` applies it to a companion. Application
is **idempotent and re-basing** — a stored `companion.createdUndeadBonus` marker
means a level-up re-applies the *new* totals instead of stacking.
`charactersheet-spells.js` calls it automatically when Animate Dead raises
Skeletons/Zombies via `_pShowRaiseUndeadPicker`.

### Prose spell grants — raw entries, level gating, feature-wide limits

`SpellGrantParser` is the fallback for features that grant spells in prose
rather than through a structured `additionalSpells` block — i.e. essentially
all homebrew. Three generic behaviours matter:

**1. Raw entries beat the rendered description.**
`SpellGrantParser.getFeatureSpellText(feature)` walks the feature's raw
`entries` tree and returns it whenever it carries `{@spell …}` tags, falling
back to `feature.description`. A stored feature's `description` is often
already-rendered HTML in which every tag has become an `<a href>`, so parsing
it finds nothing. Selection is driven by "which text actually has tags", so
description-only features are unaffected. See CS-BUG-066.

**2. "At Nth level you also learn X" is honoured.**
`parseSpellsFromText()` stamps each parsed spell with a `minLevel` derived from
the sentence that introduced it (`at 10th level`, `when you reach 15th
level`, …). `_processFeatureSpells()` grants only the spells the character
qualifies for and stashes the rest on `feature._deferredSpellGrants`;
`reconcileDeferredFeatureSpells()` (called from `getInnateSpells()` and
`applyClassFeatureEffects()`) releases them as the class level rises. Gate
levels are compared against the **granting class's** level, not total level,
so multiclassing does not unlock a tier early.

**3. A shared casting limit stated once binds every spell in the feature.**
`_parseFeatureWideCastingLimit()` looks for a *single sentence* containing
`cast`, `once` and `short|long rest` and uses it as the fallback limit for any
spell that found no local one. Without it, "You learn X and Y. … You can cast
each of these spells once until you finish a long rest" produced two unlimited
innate spells. See CS-BUG-067.

An at-will re-grant of an already-granted spell **upgrades** it —
`_mergeSpellMetadata()` sets `atWill` and drops `uses`/`recharge` — which is how
Reduce Gravity's level-15 tier works.

All three behaviours are pinned in `CharacterSheetMeteorKnight.test.js` and each
pin has been **measured** against a faithful negative control on the full
`charactersheet/` suite (13,100 tests): reverting (1) turns 1 test red,
reverting (2) — by making `_parseSpellGrantMinLevel()` return `null`
unconditionally, which restores pre-feature semantics without deleting a symbol
— turns 5 red, and reverting (3) to the original local-context-only
`isOnce`/`recharge` expressions turns 5 red.

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

## Class summons — the generic `CLASS_SUMMON` companion

Features that summon a statblock whose numbers **scale with class level**
(College of Creation's *Dancing Item* today; Steel Defender, Drake
Companion, Summon Beast tomorrow) do **not** get a bespoke recalculation
path. They register through the shared companion machinery with
`type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON` and a
declarative `scaling` descriptor:

```javascript
this.addCompanion({
    name: "Dancing Item",
    source: "TCE",
    type: CharacterSheetState.COMPANION_TYPES.CLASS_SUMMON,
    origin: CharacterSheetState.ANIMATING_PERFORMANCE_ORIGIN,
    ac: calc.dancingItemAc,
    hp: {max: calc.dancingItemHp, current: calc.dancingItemHp},
    scaling: {
        className: "Bard",
        hpBase: 10,
        hpPerLevel: 5,
        ac: 16,
        attackName: "Force-Empowered Slam",
        attackAbility: "cha",       // to-hit = getSpellAttackBonusForAbility("cha")
        damageDice: "1d10",
        damageAddProf: true,        // + proficiency bonus
        damageType: "force",
    },
});
```

`recalculateCompanion()` short-circuits to `_recalculateScaledCompanion()`
whenever `companion.scaling` is present, so every level-up, ASI and
multiclass respec re-derives HP, AC, to-hit and damage automatically.

| `scaling` key | Effect |
|---|---|
| `className` | Level source; omit to use total character level |
| `hpBase` / `hpPerLevel` | `max = hpBase + hpPerLevel × level` |
| `ac` | Flat AC |
| `attackName` | Action + attack row name (created if absent, rewritten if present) |
| `attackAbility` | To-hit = `getSpellAttackBonusForAbility(ability)`; omit for a bare proficiency bonus |
| `damageDice` | Damage dice expression |
| `damageAddProf` | Adds the proficiency bonus to damage |
| `damageType` | Damage type appended to the damage line |
| `tempHpBase` / `tempHpPerLevel` | `temp = max(existing, tempHpBase + tempHpPerLevel × level)`, recorded as `companion.tempHpMax` |

Semantics worth knowing:

- **A damaged summon is never silently healed.** HP is refilled to the new
  max only when it was at full before the recalculation; otherwise it is
  clamped.
- **Dropping the class does not collapse the summon.** If `className`
  resolves to level 0 (multiclass respec), the last known HP is kept.
- `scaling` survives `toJson()` / `loadFromJson()`, so a saved character
  re-derives correctly on the next level-up.

## College of Creation (Bard, TCE)

| Level | Feature | Calculation keys | What actually happens |
|---|---|---|---|
| 3 | Mote of Potential | `hasMoteOfPotential`, `moteOfPotentialDie`, `moteAbilityCheckBonus`, `moteAttackDamage`, `moteAttackDamageType`, `moteOfPotentialSave`, `moteOfPotentialDc`, `moteSavingThrowTempHp`, `moteSavingThrowTempHpBonus` | `getMoteOfPotentialModes()` returns the three resolved modes; `rollMoteOfPotential(modeId, opts)` rolls the rider and (opt-in) applies temp HP. Costs **nothing** — the Bardic Inspiration die was already spent when it was handed out. |
| 3 | Performance of Creation | `hasPerformanceOfCreation`, `createdItemMaxGp`, `createdItemMaxSize`, `createdItemMaxCount`, `createdItemDurationHours`, `performanceOfCreationSlotLevel` | `createPerformanceOfCreationItem({name, valueGp, size, spellSlotLevel})` puts a real `_isCustom` item into inventory, enforcing the gp cap (`20 × bard level`), the size cap (Medium → Large @6 → Huge @14) and the simultaneous-item cap; `dismissPerformanceOfCreationItems(id?)` vanishes them. |
| 6 | Animating Performance | `hasAnimatingPerformance`, `dancingItemHp`, `dancingItemAc`, `dancingItemAttackBonus`, `dancingItemDamage`, `dancingItemDamageType`, `animatingPerformanceSlotLevel` | `animateDancingItem({itemName, spellSlotLevel})` registers the scaling `CLASS_SUMMON` companion above; `dismissDancingItem()` removes it. |
| 14 | Creative Crescendo | `hasCreativeCrescendo`, `createdItemMaxCount` = `max(2, CHA mod)`, `createdItemMaxGp` = **`null`** | `null` is the JSON-safe "no gp cap" sentinel — it is *present and null*, never absent, so a probe can tell "cap removed" apart from "calculation forgot the key". Only one simultaneous item may be at the maximum size. |

Both `Performance of Creation` and `Animating Performance` accept the RAW
"unless you expend a spell slot of Nth level or higher" alternative:
passing `spellSlotLevel` spends the slot instead of the long-rest use.
`CharacterSheetState.featureOwnsItsCost(feature)` tells the UI layer that
these features manage their own cost, so the generic activation guard
does not refuse them when the use pool is empty.

`onLongRest()` calls `_clearCreationBardConstructs()`, which vanishes
every created item and the Dancing Item before the pools refill.

---

*Previous: [State Management](./04-state-management.md) | Next: [Combat System](./06-combat-system.md)*

## Shadow Magic (Sorcerer, XGE)

Published under `case "Shadow Magic": case "Shadow":`. The subclass gate is
`is2024 ? 3 : 1` — the 2014 Sorcerer picks its origin at **level 1**, which is
also why the Builder renders a subclass radio list on the very first step.

```javascript
// L1 — Eyes of the Dark
hasEyesOfTheDark: true,
darkvision: 120,                       // → generic sense effect, see below
darkvisionSource: "Eyes of the Dark",
eyesOfTheDarkGrantsDarkness: level >= 3,
darknessSorceryPointCost: 2,
resourceCastSpells: [{spell: "Darkness", resource: "Sorcery Points", cost: 2, …}],

// L1 — Strength of the Grave
hasStrengthOfTheGrave: true,
strengthOfTheGraveDc: 5,               // + damage taken, resolved at trigger time
strengthOfTheGraveSaveAbility: "cha",

// L6 — Hound of Ill Omen
hasHoundOfIllOmen: true,
houndOfIllOmenCost: 3,
houndOfIllOmenTempHp: Math.floor(level / 2),
houndOfIllOmenRange: 120,
houndOfIllOmenDurationMinutes: 5,

// L14 — Shadow Walk
hasShadowWalk: true,
shadowWalkRange: 120,
shadowWalkAction: "bonus",

// L18 — Umbral Form
hasUmbralForm: true,
umbralFormCost: 6,
umbralFormDurationMinutes: 1,
umbralFormResistanceExceptions: ["force", "radiant"],
```

Four of these ride generic engine mechanisms rather than subclass code.

### `darkvision` — generic sense effect

`_getClassFeatureEffects()` turns any `calculations.darkvision > 0` into
`{type: "sense", sense: "darkvision", range, source}`. Before CS-BUG-082 six
subclasses wrote this calculation and **nothing read it**, so class-granted
darkvision did not exist. The sense pipeline takes the maximum, so a Dwarf's
racial 60 and Eyes of the Dark's 120 resolve to 120 in either application
order.

### Zero-HP interventions — declarative registry

Strength of the Grave is a *trigger*, not an activatable, so it hangs off
`takeDamage()`:

```javascript
static ZERO_HP_INTERVENTIONS = {
    strengthOfTheGrave: {
        featureName: "Strength of the Grave",
        gate: "hasStrengthOfTheGrave",
        saveAbility: "cha",
        dcBase: 5,
        dcAddsDamage: true,          // DC = 5 + damage taken
        excludedDamageTypes: ["radiant"],
        excludedOnCritical: true,
        hpOnSuccess: 1,
        spendUseOn: "success",       // a failed save does NOT burn the use
        recharge: "long",
    },
};
```

`takeDamage(damage, {damageType, isCritical})` arms a pending intervention when
HP reaches 0 and no Death Ward fires;
`getPendingZeroHpIntervention()` / `applyZeroHpIntervention(id, {roll, total})`
resolve it. `charactersheet.js` `_pOfferZeroHpIntervention()` prompts only for
the facts the sheet cannot know (was it radiant? was it a crit?).

**`_onDamage()` now routes through `takeDamage()`** (CS-BUG-081). It previously
hand-rolled the temp/current-HP arithmetic, which meant *every* hook on
`takeDamage` — including the pre-existing Death Ward branch — was unreachable
from the sheet's own Damage button.

### `resourceCastSpells` — generic resource-cast spells

Any feature calculation may publish:

```javascript
resourceCastSpells: [{
    spell: "Darkness",
    resource: "Sorcery Points",
    cost: 2,
    seeThrough: true,             // caster ignores its own obscurement
    feature: "Eyes of the Dark",
}],
```

`getResourceCastableSpells()`, `castSpellWithResource(name)`,
`getActiveResourceCastSpells()` and `endResourceCastSpell(name)` operate on it,
and `charactersheet.js` routes any activation of a feature publishing
`resourceCastSpells` to `_pCastSpellWithResource` without a per-subclass case.
`canSeeThroughOwnDarkness()` reads the `seeThrough` flag of an *active* entry —
casting *darkness* from a spell slot correctly does **not** grant the sight.

### Hound of Ill Omen — `CLASS_SUMMON` + `scaling`

A dire wolf re-typed to size M / monstrosity, registered through
`addCompanion()` with `scaling: {className: "Sorcerer", tempHpPerLevel: 0.5}`.
The temp HP is *additional* to the dire wolf's own 37 HP, which is why it uses
the new `tempHpPerLevel` key rather than `hpPerLevel`. No bespoke recalculation
path — `recalculateCompanion()` re-derives it on every level-up.

---

## Lunar Sorcery (Sorcerer, DSotDQ)

Published under `case "Lunar Sorcery": case "Lunar":`. The subclass exists for
both the 2014 (`PHB`) and 2024 (`XPHB`) Sorcerer chassis; the gate is
`is2024 ? 3 : 1`, so on the 2014 chassis every lunar feature is a plain
sorcerer-level gate from level 1.

The subclass is built around a **recurring player choice** — the lunar phase.
It is not a note on the Features tab: the phase is stored state, it is switched
from a dedicated Combat-tab panel, and four separate engine paths read it.

```javascript
// L1 — Lunar Sorcery / Lunar Embodiment
hasLunarSorcery: true,
hasLunarEmbodiment: true,
lunarPhase: "full" | "new" | "crescent",      // ← the live choice
lunarPhaseName: "Full Moon",
lunarPhaseSchools: ["Abjuration", "Divination"],
lunarSpellTableRows: 5,                        // rows unlocked at this level
lunarFreeCastCount: 1,                         // 3 from L6 (one per phase)

// L1 — Moon Fire
hasMoonFire: true,
moonFireSpell: "Sacred Flame",
moonFireTargetCount: 2,
moonFireTargetSeparation: 5,

// L6 — Lunar Boons
hasLunarBoons: true,
lunarBoonsUses: <proficiency bonus>,
lunarBoonsReduction: 1,                        // sorcery points off a metamagic

// L6 — Waxing and Waning
hasWaxingAndWaning: true,
waxingAndWaningCost: 1,
waxingAndWaningAction: "bonus",

// L14 — Lunar Empowerment
hasLunarEmpowerment: true,
lunarEmpowermentSummary: "…",                  // phase-dependent
lunarEmpowermentResistances: ["necrotic", "radiant"],   // Crescent only
lunarMoonlightRadius: 10,

// L18 — Lunar Phenomenon
hasLunarPhenomenon: true,
lunarPhenomenonCost: 5,                        // SP cost for a re-use
lunarPhenomenonRange: 30,
lunarPhenomenonAction: "bonus",
lunarPhenomenonDamage: "3d10",                 // phase-dependent
lunarPhenomenonHealing: "3d8",                 // Full Moon only
```

### The phase is stored state, not a calculation

`_data.lunarPhase` is the single source of truth and `setLunarPhase()` is its
only writer. Everything else is derived:

| Reader | What the phase changes |
|---|---|
| `getLunarSpellsForPhase()` / `getLunarFreeCastOptions()` | which of the 15 table spells the free 1/long-rest cast may pick |
| `getCastableActiveMetamagics()` | Lunar Boons knocks 1 SP off a metamagic applied to a spell of the phase's two schools |
| `getResistances()` / `getAdvantageState()` | Lunar Empowerment's L14 passives |
| `getLunarPhenomenon()` | which burst L18 produces, its save ability, damage and healing |

`LUNAR_PHASES` is a declarative descriptor table (schools, empowerment,
phenomenon, spell column) — adding or re-tuning a phase touches data, not
branches.

### L14 passives ride the active-state engine

Three `ACTIVE_STATE_TYPES` entries (`lunarPhaseFull`, `lunarPhaseNew`,
`lunarPhaseCrescent`) mirror the stored phase; `setLunarPhase()` keeps exactly
one of them active. Their `effects` arrays are **empty** — the real effects are
produced at read time by `_getSupplementalActiveStateEffects()` →
`_getLunarPhaseStateEffects()`, which returns `[]` below sorcerer 14 and
otherwise emits:

- **Full Moon** — advantage on Investigation and Perception, but only while the
  bonus-action moonlight is actually shed (`_data.lunarMoonlight`).
- **New Moon** — advantage on Stealth always; attacks against you have
  disadvantage while `_data.lunarInDarkness`.
- **Crescent Moon** — `damage:necrotic` and `damage:radiant` resistance.

Two conventions matter here. Resistance targets are `damage:<type>`-namespaced
(CS-BUG-050), and all three states carry `noNameDetect: true` so the generic
activatable surface cannot hijack them (CS-BUG-083) — the dedicated Combat-tab
panel owns the UI, the same way the Metamagic Dashboard does.

`_getLunarPhaseStateEffects()` reads stored class data only. It must never call
`getFeatureCalculations()`, which would recurse — the same rule
`_getCircleOfTheSeaClass()` follows.

> **Generic fix shipped with this subclass.** `getAdvantageState()` hand-rolled
> its own active-state effect collection from `stateType.effects` plus
> `state.customEffects` and never consulted `_getSupplementalActiveStateEffects()`.
> Any advantage produced by the supplemental hook reached `getResistances()` but
> was invisible to `getAdvantageState()`. It now folds the supplemental effects
> in, which fixes the hook for every subclass that uses it, not just this one.

### Lunar Boons is spent on the real cast path

`getCastableActiveMetamagics()` resolves the discount and returns `baseCost`,
`lunarBoonApplied` and `lunarBoonSchool` alongside the usual `cost`.
`charactersheet-spells.js` routes all three former
`useSorceryPoint(metamagic.cost)` call sites through a single
`_spendMetamagicCost()` helper, so a boon use is burned **only** when the
discounted cost is actually paid — never on a preview, never twice.
