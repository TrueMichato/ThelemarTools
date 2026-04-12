# Party Tracker Reference

Compressed reference for `PartyTrackerCharacter`, `PartyTrackerCharacterSerializer`, and `PartyTrackerDcCalc`.

## Character Data Shape

```javascript
{
  id, name, race: string,
  classes: [{ name, level (1-20), source }],
  abilities: { str, dex, con, int, wis, cha },     // default 10
  saveProficiencies: { str..cha: boolean },
  skillProficiencies: { [skill]: 0|1|2 },           // 0=none, 1=prof, 2=expertise
  toolProficiencies: string[],
  languages: string[],
  ac: number,                                        // default 10
  speed: { walk, fly, swim, climb, burrow },         // default walk=30
  senses: { darkvision, blindsight, tremorsense, truesight }, // default 0
  combatTraditions: string[],                        // TGTT tradition codes
  exhaustionLevel: number,
  currentWeight: number,
  journeyActions: number,                            // 1-4, activity slots
  overrides: { proficiencyBonus, skillBonuses, saveBonuses, carryCapacity, combatMethodDc },
  bonuses: { skills, saves, passives },
  notes: string,
  conditions: [{ name, source }],
  diseases: [{ name, source }],
  counters: [{ name, current, max }]
}
```

## Serialization Keys

| Full | Short | Full | Short |
|------|-------|------|-------|
| name | n | abilities | ab |
| race | r | saveProficiencies | sv |
| classes | cl | skillProficiencies | sp |
| toolProficiencies | tp | languages | lng |
| speed | spd | senses | sns |
| combatTraditions | ct | exhaustionLevel | exh |
| currentWeight | cw | overrides | ov |
| bonuses | bon | journeyActions | ja |
| notes | nt | conditions | cnd |
| diseases | dis | counters | ctr |

Settings: `et`=enableTgtt, `tcw`=carryWeight, `tj`=jumping, `tlb`=linguisticsBonus, `tcr`=criticalRolls, `exr`=exhaustionRules

## Calculation Formulas

### Core

```
getTotalLevel()      = sum(classes[].level) || 1
getProficiencyBonus() = override ?? floor((totalLevel - 1) / 4) + 2
getAbilityMod(ab)    = floor((abilities[ab] - 10) / 2)
```

### Skill Bonus

```
getSkillBonus(skill):
  override → return
  base = abilityMod + (profLevel × profBonus)
  if linguistics + TGTT: += linguisticsBonus  (count of non-"common" languages)
  += exhaustionD20Penalty
  += bonuses.skills[skill]
```

### Save Bonus

```
getSaveBonus(ab):
  override → return
  base = abilityMod + (hasProficiency ? profBonus : 0)
  += exhaustionD20Penalty + bonuses.saves[ab]
```

### Passive

```
getPassiveScore(skill) = 10 + getSkillBonus(skill) + bonuses.passives[skill]
```

### Carry Capacity

```
Standard:   STR × 15
TGTT:       max(50, 50 + 25 × getSkillBonusRaw("might"))
Override:   overrides.carryCapacity
```

### Jump Distances

```
Standard:
  longRunning  = STR score       longStanding  = floor(STR / 2)
  highRunning  = 3 + strMod      highStanding  = floor((3 + strMod) / 2)

TGTT:
  ath = getSkillBonusRaw("athletics")
  longRunning  = 8 + ath         longStanding  = floor((8 + ath) / 2)
  highRunning  = floor(2 + ath×0.5)  highStanding = floor((2 + ath×0.5) / 2)
```

### TGTT-Only

```
getCombatMethodDc() = 8 + profBonus + max(strMod, dexMod) + exhaustionDcPenalty
getStaminaMax()     = 2 × profBonus
```

## Exhaustion Rules

| Rule Set | Max | D20 Penalty | DC Penalty | Speed Penalty |
|----------|-----|-------------|-----------|--------------|
| thelemar | 10 | −level | −level | none |
| 2024 | 6 | −level | none | −5×level ft |
| standard | 6 | none | none | none |

## DC Calculator

### Probability (Standard)

```
normal:  target = DC - bonus → (21 - target) / 20, clamped [5%, 95%]
advantage:  1 - (1-pNormal)²
disadvantage: pNormal²
```

### Probability (TGTT Critical Rolls)

Face-by-face: Nat 1 effective = 1−5+bonus, Nat 20 effective = 20+5+bonus. No 5%/95% clamp.
Advantage: iterate 400 pairs, take max face. Disadvantage: take min face.

### Group Check DP

```
dp[0] = 1
for each player i:
  next[j+1] += dp[j] × p[i]     // success
  next[j]   += dp[j] × (1-p[i]) // failure
pPass = sum(dp[ceil(N/2)..N])
pAllPass = dp[N], pAllFail = dp[0]
```

## Skills Map

**Standard 18**: athletics(STR) acrobatics(DEX) sleightOfHand(DEX) stealth(DEX) arcana(INT) history(INT) investigation(INT) nature(INT) religion(INT) animalHandling(WIS) insight(WIS) medicine(WIS) perception(WIS) survival(WIS) deception(CHA) intimidation(CHA) performance(CHA) persuasion(CHA)

**TGTT 7**: cooking(WIS) culture(INT) endurance(CON) engineering(INT) harvesting(WIS) linguistics(INT) might(STR)

## Combat Traditions (17)

AM=Adamant Mountain, AK=Arcane Knight, BU=Beast Unity, BZ=Biting Zephyr, CJ=Comedic Jabs, EB=Eldritch Blackguard, GH=Gallant Heart, MG=Mirror's Glint, MS=Mist and Shade, RC=Rapid Current, RE=Razor's Edge, SK=Sanguine Knot, SS=Spirited Steed, TI=Tempered Iron, TC=Tooth and Claw, UW=Unending Wheel, UH=Unerring Hawk

## Collapsed Row Elements

`name | race | classes | 🛡AC | 👁PPerc | 🔍PInv | 💡PIns | 🗣PLing(TGTT) | 🏋carry(warn/danger) | 👀senses | ➡⬆jump | 💤exh(danger) | conditions | TGTT stats | remove`
