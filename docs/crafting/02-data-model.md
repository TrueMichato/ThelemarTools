# Crafting Data Model

Everything below lives in `data/crafting.json`, which is **generated**. Do not hand-edit it — see
[03-generator.md](03-generator.md).

## `craftingMaterial`

```jsonc
{
  "name": "Alhoon Skin",
  "source": "HHHVII",
  "page": 31,

  "materialCategory": "creature part",   // creature part | herb | mineral | food ingredient | spell component | other
  "materialKind": "Bone",                // optional — the Complete Crafter material this counts as

  "harvest": {
    "dc": 10,
    "quantity": 1,
    "quantityRoll": "1d4",               // optional — present instead of a fixed `quantity`
    "time": "15 minutes",                // optional — Arcadia 8 only
    "creature": {
      "name": "Alhoon",                  // bestiary spelling, used for linking
      "source": "MPMM",                  // null when the creature is not in the local bestiary
      "label": "Alhoons"                 // optional — the handbook's own wording, when it differs
    },
    "creatureType": "undead",            // denormalised from the bestiary for filtering
    "cr": 10,
    "biome": "Coast",                    // herbs only
    "requiresPreparation": false,        // herbs only
    "shelfLife": "short",                // food ingredients only — short | medium | long
    "valueByCr": true                    // optional — Complete Crafter materials priced by creature CR
  },

  "value": 1000,                          // copper pieces, per the 5etools `item.value` convention
  "weight": 15,                           // pounds
  "rarity": "rare",                       // optional

  "entries": [ /* description + Use:/Effect: block, preserved verbatim from the book */ ],

  "hasUseEffect": false,                  // true when the entry has a `Use:` / `Effect:` sub-entry
  "hasMechanicalEffect": false,           // true when any effect tag is mechanical (not just "trade good")

  "effectTags": ["crafting ingredient", "trade good"],

  "usedInRecipes": [                      // built by the graph pass
    {"name": "Alhoon Ink", "source": "HHHVII", "uid": "alhoon ink|hhhvii"},
    {"name": "Potion of Water Breathing", "source": "DMG", "uid": "…", "isExternal": true}
  ],

  "alsoIn": [{"name": "Alhoon Skin", "source": "COMCRAF"}],   // same name in another book

  "spells": [{"name": "legend lore", "source": "phb"}],       // spell components only
  "variantComponent": { /* Arcadia 8's structured block, copied verbatim */ }
}
```

`isExternal` on a `usedInRecipes` entry means the craft target is a real item in another book
(DMG, PHB, …) rather than a `craftingRecipe` we model, so it renders as an `{@item}` link.

### `variantComponent`

Copied unchanged from `data/items-variant-components-ar8.json`, which remains the **character
sheet's** source of truth for spellcasting with monstrous components. The generator only ever
reads that file.

```jsonc
{
  "harvestDC": 20,
  "harvestQuantity": 8,
  "harvestSource": "Aboleth",
  "harvestTime": "30 minutes",
  "spellEffects": [
    {
      "match": {"damageType": "psychic"},
      "description": "Damage die +1 step (max d12), +3 extra damage dice.",
      "effects": [
        {"type": "dieSizeIncrease", "steps": 1, "maxDie": "d12"},
        {"type": "bonusDice", "count": 3}
      ]
    }
  ]
}
```

## `craftingRecipe`

```jsonc
{
  "name": "Basilisk Burgers",
  "source": "Arcadia11",
  "page": 28,

  "recipeCategory": "dish",              // item | potion | scroll | dish | curse
  "crafter": "Cook",                     // Alchemist | Artificer | Blacksmith | Cook | Leatherworker | Thaumaturge | Tinker
  "craftDC": 14,                          // cooking DC for dishes
  "complexity": "special",                // dishes only — simple | special
  "rarity": "uncommon",                   // optional
  "reqAttune": true,                      // optional

  "ingredients": [
    {
      "name": "flour",
      "quantity": 1,
      "unit": "portion",                  // optional
      "uid": "flour|arcadia11",           // null when no material entry matches
      "group": "Bun",                     // optional — Arcadia recipes split into named components
      "isAlternative": true,              // optional — one of an "A or B or C" set
      "alternativeGroup": "alt-0",
      "alternativeIndex": 1,
      "isInferred": true                  // optional — derived from a material's Crafting column
    }
  ],

  "componentGroups": ["Bun", "Burger \"Batty\""],   // optional — present when >1 group

  "outcomes": [                           // dishes only
    {"tier": "success", "entries": ["…"]},
    {"tier": "delicious", "entries": ["…"]},
    {"tier": "extraDelicious", "entries": ["…"]}
  ],

  "itemUid": "basilisk burgers|arcadia11",
  "value": 5000,
  "entries": [ /* the book's own text, verbatim */ ],
  "effectTags": ["food", "petrified", "poison damage", "…"],
  "hasMechanicalEffect": true
}
```

## `craftingRule`

```jsonc
{
  "name": "Optional Rule: Carcass Degradation",
  "source": "HHHVI",
  "page": 5,
  "ruleCategory": "harvesting",           // harvesting | crafting | cooking | components | materials
  "ruleType": "O",                        // optional — 5etools variantrule type
  "skillAbility": "wis",                  // optional — for the Cooking / Harvesting skills
  "otherSources": [{"source": "HHHVII", "page": 5}],
  "entries": [ /* … */ ]
}
```

## Conventions

- **Values are copper pieces.** `1000` renders as `10 gp`.
- **Weights are pounds.**
- **`name|source` is the identity key**, lowercased. Two books describing the same material each
  keep their own entry, cross-referenced via `alsoIn`.
- **`harvest.creature.name` is the bestiary spelling**, so it links and filters correctly; the
  handbook's own wording is preserved in `label` when they differ.
