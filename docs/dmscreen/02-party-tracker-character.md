# Party Tracker — Character Model

`PartyTrackerCharacter` is the data model and UI renderer for individual characters in the Party Tracker. It stores all character fields, computes derived values (ability mods, skill bonuses, carry capacity, jump distances), and renders both collapsed summary rows and expanded editing forms.

## Character Data Shape

```javascript
{
  id: string,                     // UUID (auto-generated)
  name: string,                   // Character name
  race: string,                   // Race/species
  classes: [                      // Multiclass support
    { name: string, level: number (1-20), source: string|null }
  ],
  abilities: {                    // Base ability scores (1-30, default 10)
    str, dex, con, int, wis, cha: number
  },
  saveProficiencies: {            // Boolean per ability
    str, dex, con, int, wis, cha: boolean
  },
  skillProficiencies: {           // 0=none, 1=proficient, 2=expertise
    athletics, acrobatics, sleightOfHand, stealth,
    arcana, history, investigation, nature, religion,
    animalHandling, insight, medicine, perception, survival,
    deception, intimidation, performance, persuasion,
    // TGTT skills (always present, ignored if TGTT disabled)
    cooking, culture, endurance, engineering, harvesting, linguistics, might: number
  },
  toolProficiencies: string[],    // Free-text tool names
  languages: string[],            // Free-text language names
  ac: number,                     // Armor class (default 10)
  speed: {                        // Movement speeds in feet
    walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0
  },
  senses: {                       // Sense ranges in feet
    darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0
  },
  combatTraditions: string[],     // TGTT combat tradition codes (e.g. "AM", "BZ")
  exhaustionLevel: number,        // 0 to maxExhaustion
  currentWeight: number,          // Currently carried weight in pounds
  journeyActions: number,         // Number of journey activity slots (1-4, default 1)
  overrides: {                    // Manual overrides (null = use calculated)
    proficiencyBonus: number|null,
    skillBonuses: { [skill]: number },
    saveBonuses: { [ability]: number },
    carryCapacity: number|null,
    combatMethodDc: number|null
  },
  bonuses: {                      // Flat bonuses that stack on top of calculations
    skills: { [skill]: number },
    saves: { [ability]: number },
    passives: { [skill]: number }
  },
  notes: string,                  // Free-text notes
  conditions: [{ name: string, source: string|null }],
  diseases: [{ name: string, source: string|null }],
  counters: [{ name: string, current: number, max: number }]
}
```

## Serialization Format

`PartyTrackerCharacterSerializer` compresses keys for localStorage storage:

| Full Key | Compressed | Type | Notes |
|----------|-----------|------|-------|
| `id` | `id` | string | UUID |
| `name` | `n` | string | |
| `race` | `r` | string | |
| `classes` | `cl` | array | Each: `{n: name, l: level, s: source}` |
| `abilities` | `ab` | object | `{str, dex, con, int, wis, cha}` |
| `saveProficiencies` | `sv` | object | |
| `skillProficiencies` | `sp` | object | |
| `toolProficiencies` | `tp` | array | |
| `languages` | `lng` | array | |
| `ac` | `ac` | number | |
| `speed` | `spd` | object | |
| `senses` | `sns` | object | |
| `combatTraditions` | `ct` | array | |
| `exhaustionLevel` | `exh` | number | |
| `currentWeight` | `cw` | number | |
| `overrides` | `ov` | object | |
| `bonuses` | `bon` | object | |
| `journeyActions` | `ja` | number | |
| `notes` | `nt` | string | |
| `conditions` | `cnd` | array | Each: `{n: name, s: source}` |
| `diseases` | `dis` | array | Each: `{n: name, s: source}` |
| `counters` | `ctr` | array | |

Deserialization provides defaults for every field, ensuring backward compatibility when new fields are added.

## Derived Calculations

### Proficiency Bonus

```javascript
getProficiencyBonus()
  if overrides.proficiencyBonus != null → return override
  return floor((totalLevel - 1) / 4) + 2     // Standard 5e formula: +2 at 1, +3 at 5, etc.
```

### Ability Modifier

```javascript
getAbilityMod(ability)
  score = abilities[ability] ?? 10
  return floor((score - 10) / 2)
```

### Skill Bonus

```javascript
getSkillBonus(skill)
  if overrides.skillBonuses[skill] != null → return override
  ability = SKILL_TO_ABILITY[skill]
  bonus = abilityMod + (proficiencyLevel × proficiencyBonus)
  if skill === "linguistics" && TGTT enabled && linguisticsBonus → bonus += linguisticsBonus
  bonus += exhaustionD20Penalty
  bonus += bonuses.skills[skill]
  return bonus
```

**Linguistics Bonus** (TGTT): +1 per non-Common language in the character's language list.

### Save Bonus

```javascript
getSaveBonus(ability)
  if overrides.saveBonuses[ability] != null → return override
  bonus = abilityMod + (hasProficiency ? proficiencyBonus : 0)
  bonus += exhaustionD20Penalty
  bonus += bonuses.saves[ability]
  return bonus
```

### Passive Score

```javascript
getPassiveScore(skill) = 10 + getSkillBonus(skill) + bonuses.passives[skill]
```

### Carry Capacity

| Rule Set | Formula |
|----------|---------|
| Standard 5e | `STR × 15` |
| TGTT (Might-based) | `max(50, 50 + 25 × mightModRaw)` |
| Override | Direct value from `overrides.carryCapacity` |

`mightModRaw` = `getSkillBonusRaw("might")` which is the raw skill bonus *without* exhaustion penalty or manual bonuses.

### Jump Distances

| Rule Set | Long Running | Long Standing | High Running | High Standing |
|----------|-------------|---------------|-------------|---------------|
| Standard 5e | `STR score` ft | `floor(STR / 2)` ft | `3 + STR mod` ft | `floor((3 + STR mod) / 2)` ft |
| TGTT (Athletics) | `8 + athleticsMod` ft | `floor((8 + athleticsMod) / 2)` ft | `floor(2 + athleticsMod × 0.5)` ft | `floor((2 + athleticsMod × 0.5) / 2)` ft |

`athleticsMod` = `getSkillBonusRaw("athletics")` — raw modifier without exhaustion or bonuses.

### Combat Method DC (TGTT only)

```javascript
getCombatMethodDc()
  if !enableTgtt → return null
  if overrides.combatMethodDc != null → return override
  return 8 + proficiencyBonus + max(strMod, dexMod) + exhaustionDcPenalty
```

### Stamina Max (TGTT only)

```javascript
getStaminaMax() = 2 × proficiencyBonus
```

## Exhaustion System

Three exhaustion rule variants are supported, controlled by the `exhaustionRules` setting.

### Exhaustion Penalties

| Rule Set | Max Level | D20 Penalty (per level) | DC Penalty (per level) | Speed Penalty (per level) |
|----------|-----------|------------------------|----------------------|--------------------------|
| Thelemar | 10 | −1 | −1 | None |
| 2024 | 6 | −1 | None | −5 ft |
| Standard (2014) | 6 | None | None | None |

**D20 Penalty** (`getExhaustionD20Penalty()`): Applies to skill checks and save bonuses. Thelemar and 2024 rules subtract the exhaustion level from all d20 rolls.

**DC Penalty** (`getExhaustionDcPenalty()`): Only Thelemar — subtracts exhaustion level from Combat Method DC.

**Speed Penalty** (`getExhaustionSpeedPenalty()`): Only 2024 — subtracts `5 × level` from speed.

Note: The 2014 "Standard" exhaustion system uses discrete levels with specific effects (disadvantage at level 1, halved speed at level 2, etc.) that are too complex to model numerically, so no automatic penalties are applied.

## Static Data Maps

`PartyTrackerCharacterSerializer` provides static constants:

### Skills (25 total)

**Standard 18**: athletics (STR), acrobatics (DEX), sleightOfHand (DEX), stealth (DEX), arcana (INT), history (INT), investigation (INT), nature (INT), religion (INT), animalHandling (WIS), insight (WIS), medicine (WIS), perception (WIS), survival (WIS), deception (CHA), intimidation (CHA), performance (CHA), persuasion (CHA)

**TGTT 7**: cooking (WIS), culture (INT), endurance (CON), engineering (INT), harvesting (WIS), linguistics (INT), might (STR)

### Combat Traditions (17)

| Code | Name |
|------|------|
| AM | Adamant Mountain |
| AK | Arcane Knight |
| BU | Beast Unity |
| BZ | Biting Zephyr |
| CJ | Comedic Jabs |
| EB | Eldritch Blackguard |
| GH | Gallant Heart |
| MG | Mirror's Glint |
| MS | Mist and Shade |
| RC | Rapid Current |
| RE | Razor's Edge |
| SK | Sanguine Knot |
| SS | Spirited Steed |
| TI | Tempered Iron |
| TC | Tooth and Claw |
| UW | Unending Wheel |
| UH | Unerring Hawk |

## Collapsed Row Stats

The collapsed summary row displays stats with emoji icons and color coding:

| Stat | Icon | Always Shown | Color Coding |
|------|------|-------------|-------------|
| AC | 🛡 | Yes | — |
| Passive Perception | 👁 | Yes | — |
| Passive Investigation | 🔍 | Yes | — |
| Passive Insight | 💡 | Yes | — |
| Passive Linguistics | 🗣 | TGTT only | — |
| Carry | 🏋 | Yes | `--warn` if >75%, `--danger` if >100% |
| Senses | 👀 | If any non-zero | — |
| Jump | ➡⬆ | Yes | — |
| Exhaustion | 💤 | If > 0 | `--danger` always |
| Conditions | pills | If any | Colored by condition type |
| Stamina/DC | text | TGTT only | — |
