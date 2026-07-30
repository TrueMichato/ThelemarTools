# The Crafting Data Generator

`data/crafting.json` is produced by `node/generate-crafting-data.js`. It is committed to the repo
so the page loads instantly and works offline.

## Running it

```sh
npm run gen:crafting          # just the crafting data
npm run gen                   # everything, including crafting
```

Flags:

| Flag | Effect |
|---|---|
| `--refresh` | Re-download the upstream homebrew books, ignoring the cache |
| `--offline` | Never hit the network; fail if a book is not cached |

Set `CRAFTING_VERBOSE=1` to print the full diagnostic lists (unresolved creatures, unresolved
ingredients, untagged entities, skipped rows) instead of just their counts.

## Source books

Remote books are resolved from the URLs already listed in `homebrew/index.json`, so the generated
data always matches what the running site actually imports. Downloads are cached in a gitignored
`.cache/crafting/`. `homebrew/complete_crafter.json` is read from the repo.

| Key | Source | Origin |
|---|---|---|
| `hamundI` | `HHHVI` | remote |
| `hamundII` | `HHHVII` | remote |
| `hamundIII` | `HHHVIII` | remote |
| `herbalism` | `HHbH` | remote |
| `arcadia8` | `Ar8` | remote |
| `arcadia11` | `Arcadia11` | remote |
| `completeCrafter` | `COMCRAF` | `homebrew/complete_crafter.json` |

The generator **fails loudly** if a book cannot be fetched or if its `_meta.sources` no longer
contains the expected source code — that is the signal that an upstream shape change needs
attention rather than silent data loss.

## Pipeline

```
load books ─┬─ extract-hamund-materials     ─┐
            ├─ extract-herbs-and-ingredients │
            ├─ extract-variant-components    ├─→ craftingMaterial
            ├─ extract-complete-crafter      ─┘
            │
            ├─ extract-recipes               ─→ craftingRecipe
            └─ extract-rules                 ─→ craftingRule
                        │
                        ├─ dedupe by name|source
                        ├─ backfill crafter from the Hamund craft index
                        ├─ buildCraftingGraph   (material ↔ recipe, both directions)
                        ├─ markDuplicates       (alsoIn)
                        └─ applyFallbackTags    (needs the graph)
```

### Module responsibilities

| Module | Responsibility |
|---|---|
| `crafting-sources.js` | Locate, download, cache, and shape-check the source books |
| `crafting-utils.js` | Value/weight/DC/quantity/ingredient parsing; tag extraction; name joining |
| `crafting-effect-tags.js` | The effect-tag taxonomy, pattern matching, and fallback tagging |
| `resolve-creatures.js` | Match handbook creature names against the bestiary |
| `extract-hamund-materials.js` | The ~493 `DC / Item / Description / Value / Weight / Crafting` tables |
| `extract-herbs-and-ingredients.js` | Herbalism herbs and Arcadia 11 base ingredients |
| `extract-variant-components.js` | Arcadia 8 spell components (reads the already-converted file) |
| `extract-complete-crafter.js` | Named materials + the "Parts by Creature" tables |
| `extract-recipes.js` | Hamund craftables, Arcadia dishes, Complete Crafter items |
| `extract-rules.js` | Crafting-relevant `variantrule` / `skill` / `itemProperty` entries |
| `build-graph.js` | Material ↔ recipe linking and duplicate marking |

## How the tricky bits work

### Identifying harvest tables

A Hamund table is a harvest table when its `colLabels` are exactly
`["DC", "Item", "Description", "Value", "Weight", "Crafting"]`, and its `name` is the creature.
Trinket tables (`"<Creature> Trinket Table"`) and rules tables have different columns and are
skipped.

### The `[Type]` placeholder

The handbooks write age-graded dragon materials as `"[Type] Dragon Tooth"` inside a table named
`"Adult Dragon"`. Left alone, all four age bands collapse onto one `name|source`. The extractor
resolves the placeholder against the table's creature —
`joinCreatureAndMaterialName("Adult Dragon", "Dragon Tooth")` → `"Adult Dragon Tooth"` — which
keeps them distinct *and* makes them match the ingredient references that name them that way.

### Creature-name resolution

`resolve-creatures.js` generates candidate spellings before giving up:

| Handbook spelling | Bestiary spelling |
|---|---|
| `Brass Dragon (Adult)` | `Adult Brass Dragon` |
| `Naga, Bone` | `Bone Naga` |
| `Succubus/Incubus` | `Succubus` |
| `Drow Favoured Consort` | `Drow Favored Consort` |
| `Galeb-Duhr` | `Galeb Duhr` |
| `Ancient Dracolich` | `Dracolich` (age qualifier dropped as a last resort) |

Genuine one-offs (`Hooked Horror` → `Hook Horror`) live in a small `NAME_ALIASES` table. Names
that describe a *category* rather than a stat block (`Dragon (any)`, `Mephit`, `Lycanthropes`) are
recognised as generic and reported separately from real misses.

### Ingredient matching

Ingredient text and material names rarely agree, so `build-graph.js` indexes each material under
several keys: its exact name, its name with any parenthetical stripped
(`"Salamander Scale (large pouch)"` → `salamander scale`), a creature-prefixed form
(`"Hide"` on `"Bone Devil"` → `bone devil hide`), and singular/plural variants.

Ingredient strings themselves handle `×N`, `×N <unit>`, fractional `×1/3`, comma/semicolon lists,
and `A or B or C` alternative sets.

## Reading the report

```
craftingMaterial  1860
craftingRecipe    456
craftingRule      40

Effect-tag coverage  2314/2316 (99.9%)
Materials linked to a craftable  642
Recipes with ingredients         444
External craft targets (DMG/etc) 206

12 unresolved creature name(s)
63 unresolved ingredient reference(s)
2 entit(ies) with no effect tags
```

Expected residue:

- **Unresolved creatures** are MCDM creatures from *Strongholds &amp; Followers* / *Kingdoms &amp;
  Warfare*, which are not in the local bestiary. They keep their raw name and simply get no
  type/CR filter.
- **Unresolved ingredients** are mostly source typos (`"Barded Hide"` for *Barbed Devil Hide*) or
  references to materials in books we do not model.

A large jump in either number after an upstream brew update means a shape change worth
investigating.
