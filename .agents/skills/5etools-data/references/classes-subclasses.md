# Classes & Subclasses Reference

## File Structure

Each class file (`data/class/class-<name>.json`) contains four top-level arrays:

```jsonc
{
  "_meta": {"internalCopies": ["subclass", "subclassFeature"]},
  "class": [/* class objects */],
  "subclass": [/* subclass objects */],
  "classFeature": [/* class feature objects */],
  "subclassFeature": [/* subclass feature objects */]
}
```

---

## Class Object

```jsonc
{
  "name": "Fighter",
  "source": "PHB",
  "page": 70,
  "edition": "classic",                    // "classic" (2014) or "one" (2024)
  "reprintedAs": ["Fighter|XPHB"],
  "srd": true,
  "basicRules": true,

  // Hit Die
  "hd": {"number": 1, "faces": 10},

  // Saving throw proficiencies
  "proficiency": ["str", "con"],

  // Spellcasting (omit for non-casters)
  "spellcastingAbility": "int",            // str/dex/con/int/wis/cha
  "casterProgression": "full",             // full, 1/2, 1/3, pact, artificer
  "preparedSpells": "<$level$> + <$wis_mod$>",  // formula string
  "preparedSpellsChange": "restLong",      // when prepared spells can change
  "cantripProgression": [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],  // 20 entries, one per level
  "spellsKnownProgression": [2,3,4,...],   // for known-spell casters (sorcerer, ranger, etc.)

  // Optional feature progression (fighting styles, invocations, etc.)
  "optionalfeatureProgression": [
    {
      "name": "Fighting Style",
      "featureType": ["FS:F"],             // featureType code
      "progression": {"1": 1, "10": 1}    // level: count gained at that level
    }
  ],

  // Starting proficiencies
  "startingProficiencies": {
    "armor": ["light", "medium", "heavy", "shield"],
    "weapons": ["simple", "martial"],
    "tools": ["thieves' tools"],           // optional
    "skills": [
      {
        "choose": {
          "from": ["acrobatics", "athletics", "history", "insight", "intimidation", "perception", "survival"],
          "count": 2
        }
      }
    ]
  },

  // Starting equipment
  "startingEquipment": {
    "additionalFromBackground": true,
    "default": ["(a) {@item chain mail|phb} or (b) {@item leather armor|phb}"],
    "goldAlternative": "{@dice 5d4 × 10|5d4 × 10|Starting Gold}",
    "defaultData": [/* structured equipment choice objects */]
  },

  // Multiclassing rules
  "multiclassing": {
    "requirements": {
      "or": [{"str": 13, "dex": 13}]      // OR requirements
      // or just: {"str": 13}              // simple AND requirements
    },
    "proficienciesGained": {
      "armor": ["light", "medium", "shield"],
      "weapons": ["simple", "martial"]
    }
  },

  // Class features — array of UID strings or objects
  "classFeatures": [
    "Fighting Style|Fighter||1",           // UID: name|class|classSource|level
    "Second Wind|Fighter||1",              //   (classSource empty = same as source)
    "Epic Boon|Artificer|EFA|19|EFA",      // optional 5th field = feature source
    {
      "classFeature": "Martial Archetype|Fighter||3",
      "gainSubclassFeature": true          // marks where subclass is chosen
    },
    "Extra Attack|Fighter||5"
  ],

  "subclassTitle": "Martial Archetype",    // what the subclass is called

  // Class progression tables
  "classTableGroups": [
    {
      "colLabels": ["Second Wind", "Weapon Mastery"],
      "rows": [["2", "3"], ["2", "3"], ...]  // 20 rows, one per level
    }
  ],

  "hasFluff": true,
  "hasFluffImages": true
}
```

### classFeature UID Format

```
FeatureName|ClassName|ClassSource|Level[|FeatureSource]
```

When `ClassSource` matches the class's own source, it can be empty: `"Extra Attack|Fighter||5"`.
The optional fifth field preserves an explicitly source-qualified feature reference, as in
`"Epic Boon|Artificer|EFA|19|EFA"`. Consumers must continue reading the class level from
field 4 while validating the referenced class name/source against the containing class.

### classFeatures Array Entry Variants

```jsonc
// Simple UID string
"Extra Attack|Fighter||5"

// Object with subclass gain marker
{"classFeature": "Martial Archetype|Fighter||3", "gainSubclassFeature": true}
```

---

## Class Feature Object

```jsonc
{
  "name": "Fighting Style",
  "source": "PHB",
  "page": 72,
  "className": "Fighter",               // REQUIRED — which class this belongs to
  "classSource": "PHB",                 // REQUIRED — source of the class
  "level": 1,                           // REQUIRED — level gained
  "entries": [                           // REQUIRED — feature description
    "You adopt a particular style of fighting as your specialty.",
    {
      "type": "options",
      "count": 1,
      "entries": [
        {"type": "refOptionalfeature", "optionalfeature": "Archery"},
        {"type": "refOptionalfeature", "optionalfeature": "Defense"},
        {"type": "refOptionalfeature", "optionalfeature": "Dueling"}
      ]
    }
  ],

  // Optional fields
  "header": 1,                          // header level (1 or 2)
  "type": "inset",                      // "inset" or "item" for display style
  "isClassFeatureVariant": true,         // variant/optional feature (TCE)
  "consumes": {"name": "Psionic Energy Die"},  // resource this feature spends
  "srd": true,
  "basicRules": true
}
```

### Feature Patterns

**Feature with options (choose-one):**
```jsonc
{
  "type": "options",
  "count": 1,
  "entries": [
    {"type": "refOptionalfeature", "optionalfeature": "Archery"},
    {"type": "refOptionalfeature", "optionalfeature": "Defense"}
  ]
}
```

**Feature referencing another feature:**
```jsonc
{"type": "refClassFeature", "classFeature": "Extra Attack|Fighter|PHB|5"}
```

**Feature referencing a subclass feature:**
```jsonc
{"type": "refSubclassFeature", "subclassFeature": "Protective Field|Fighter|PHB|Psi Warrior|TCE|3"}
```

---

## Subclass Object

```jsonc
{
  "name": "Battle Master",
  "shortName": "Battle Master",          // REQUIRED — used in UIDs and display
  "source": "PHB",
  "className": "Fighter",               // REQUIRED — parent class
  "classSource": "PHB",                 // REQUIRED — parent class source
  "page": 73,
  "edition": "classic",
  "reprintedAs": ["Battle Master|Fighter|XPHB|XPHB"],

  // Optional feature progression (maneuvers, invocations, etc.)
  "optionalfeatureProgression": [
    {
      "name": "Maneuvers",
      "featureType": ["MV:B"],
      "progression": {"3": 3, "7": 5, "10": 7, "15": 9}  // cumulative count at each level
    }
  ],

  // Spellcasting (for spellcasting subclasses like Eldritch Knight)
  "spellcastingAbility": "int",
  "casterProgression": "1/3",
  "cantripProgression": [0,0,2,2,2,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3],
  "spellsKnownProgression": [0,0,3,4,4,4,5,6,6,7,8,8,9,10,10,11,11,11,12,13],

  // Bonus spells granted by subclass
  "additionalSpells": [
    {
      "expanded": {
        "3": [
          {"all": "level=0|class=Wizard"},
          {"all": "level=1|class=Wizard"}
        ],
        "7": [{"all": "level=2|class=Wizard"}]
      }
    }
  ],

  // Subclass-specific progression tables
  "subclassTableGroups": [
    {
      "title": "Spell Slots per Spell Level",
      "subclasses": [{"name": "Eldritch Knight", "source": "PHB"}],
      "colLabels": ["{@filter 1st|spells|level=1}", "{@filter 2nd|spells|level=2}"],
      "rowsSpellProgression": [[0,0], [0,0], [2,0], [3,0], ...]  // 20 rows
    }
  ],

  // Subclass features — array of UID strings
  "subclassFeatures": [
    "Battle Master|Fighter||Battle Master||3",
    "Know Your Enemy|Fighter||Battle Master||7",
    "Relentless|Fighter||Battle Master||15"
  ],

  "hasFluff": true
}
```

### subclassFeature UID Format

```
FeatureName|ClassName|ClassSource|SubclassShortName|SubclassSource|Level
```

Example: `"Battle Master|Fighter||Battle Master||3"` — empty source fields mean same as parent.

---

## Subclass Feature Object

```jsonc
{
  "name": "Psionic Power",
  "source": "TCE",
  "page": 42,
  "className": "Fighter",               // REQUIRED
  "classSource": "PHB",                 // REQUIRED
  "subclassShortName": "Psi Warrior",   // REQUIRED
  "subclassSource": "TCE",              // REQUIRED
  "level": 3,                           // REQUIRED
  "header": 1,                          // 1 = main header, 2 = sub-header
  "entries": [
    "{@i 3rd-level Psi Warrior feature}",
    "You harbor a wellspring of psionic energy...",
    {
      "type": "options",
      "style": "list-hang-notitle",
      "entries": [
        {"type": "refSubclassFeature", "subclassFeature": "Protective Field|Fighter|PHB|Psi Warrior|TCE|3"},
        {"type": "refSubclassFeature", "subclassFeature": "Psionic Strike|Fighter|PHB|Psi Warrior|TCE|3"}
      ]
    }
  ],
  "consumes": {"name": "Psionic Energy Die"}  // optional resource tracking
}
```

---

## Spellcasting Configurations

### Full Caster (Wizard, Cleric, Druid, Bard, Sorcerer)
```jsonc
{
  "spellcastingAbility": "wis",
  "casterProgression": "full",
  "preparedSpells": "<$level$> + <$wis_mod$>",
  "cantripProgression": [3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5]
}
```

### Half Caster (Paladin, Ranger)
```jsonc
{
  "spellcastingAbility": "wis",
  "casterProgression": "1/2",
  "preparedSpells": "<$level$> / 2 + <$wis_mod$>",
  "spellsKnownProgression": [0,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11]
}
```

### Third Caster (Eldritch Knight, Arcane Trickster)
```jsonc
{
  "spellcastingAbility": "int",
  "casterProgression": "1/3",
  "cantripProgression": [0,0,2,2,2,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3],
  "spellsKnownProgression": [0,0,3,4,4,4,5,6,6,7,8,8,9,10,10,11,11,11,12,13]
}
```

### Pact Caster (Warlock)
```jsonc
{
  "spellcastingAbility": "cha",
  "casterProgression": "pact",
  "cantripProgression": [2,2,2,2,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
  "spellsKnownProgressionFixedByLevel": {
    "1": {"1": 2},
    "2": {"1": 3},
    "3": {"1": 3, "2": 2},
    "5": {"1": 3, "2": 3, "3": 1}
  }
}
```

### Prepared Spell Formulas

Variable syntax: `<$variable$>`
- `<$level$>` — class level
- `<$str_mod$>` through `<$cha_mod$>` — ability modifiers
- `<$prof_bonus$>` — proficiency bonus

Examples:
- `"<$level$> + <$wis_mod$>"` — Cleric/Druid
- `"<$level$> / 2 + <$cha_mod$>"` — Paladin

---

## Optional Feature Progression

References features defined in `data/optionalfeatures.json`.

### featureType Codes

| Code | Feature Type |
|------|-------------|
| `FS:F` | Fighting Style: Fighter |
| `FS:R` | Fighting Style: Ranger |
| `FS:P` | Fighting Style: Paladin |
| `FS:B` | Fighting Style: Bard |
| `EI` | Eldritch Invocation |
| `MV:B` | Maneuver: Battle Master |
| `MM` | Metamagic |
| `AS` | Arcane Shot |
| `OG` | Onomancy: Resonant |
| `RN` | Rune Knight: Rune |
| `AI` | Artificer Infusion |
| `PB` | Pact Boon |
| `OR` | Onomancy: Resonant |
| `ED` | Elemental Discipline |

### Progression Object

```jsonc
{
  "name": "Maneuvers",
  "featureType": ["MV:B"],
  "progression": {
    "3": 3,      // know 3 maneuvers at level 3
    "7": 5,      // know 5 at level 7 (gained 2 more)
    "10": 7,     // know 7 at level 10
    "15": 9      // know 9 at level 15
  }
}
```

Values are **cumulative** — the number known at that level, not the number gained.

---

## Subclass _copy Pattern (for reprints)

```jsonc
{
  "name": "Battle Master",
  "shortName": "Battle Master",
  "source": "XPHB",
  "className": "Fighter",
  "classSource": "XPHB",
  "_copy": {
    "name": "Battle Master",
    "source": "PHB",
    "shortName": "Battle Master",
    "className": "Fighter",
    "classSource": "PHB",
    "_preserve": {
      "page": true,
      "reprintedAs": true,
      "srd": true,
      "basicRules": true
    }
  }
}
```

Subclass `_copy` requires additional context fields (`shortName`, `className`, `classSource`) to locate the source entity.
