# Crafting &amp; Harvesting — Overview

## The problem this page solves

Crafting content is spread across six books and is almost entirely **prose-locked**:

- Hamund's ~1,520 harvestable materials exist only as rows inside ~500 per-creature tables.
- Herbs carry their biome and preparation requirement in `customProperties`, and their effect in
  free text.
- Arcadia 11's recipes hide their ingredients and their Success / Delicious / Extra Delicious
  payoff inside nested `list` entries.
- The Complete Crafter's materials and creature-part mappings live inside `variantrule` prose.

None of that is searchable or filterable in its native form. `crafting.html` reads a **generated,
structured** dataset (`data/crafting.json`) so all of it becomes one list you can filter by
effect, creature, DC, biome, crafter, value, and rarity.

## Entity types

The page is a standard 5etools `ListPage` spanning four props.

| Prop | Abv | What it is |
|---|---|---|
| `craftingMaterial` | MAT | Anything you harvest, gather, mine, or buy as an input |
| `craftingRecipe` | CRF | Anything you can make — magic items, potions, dishes, poisons |
| `craftingRule` | RUL | The rules governing harvesting, crafting, cooking, and components |
| `itemMaterial` | MTL | What a finished item is *made of* — the 72 Thelemar materials and their six axes. See [05-item-materials.md](05-item-materials.md) |

Materials are further split by `materialCategory`: **creature part**, **herb**, **mineral**,
**food ingredient**, **spell component**.

Note the deliberate split between `craftingMaterial` and `itemMaterial`: a bar of mithril is
an input you buy (MAT); **Mithril** is a property a finished sword has (MTL).

## Filters

| Filter | Applies to | Notes |
|---|---|---|
| Source | all | The six source books |
| Type | all | Material / Craftable / Crafting Rule |
| Category | all | Grouped by which entity type the category belongs to |
| **Effect** | materials, craftables | The headline filter — see [04-effect-tags.md](04-effect-tags.md) |
| Harvesting → Source Creature | materials | Searchable; resolved against the bestiary |
| Harvesting → Creature Type, Creature CR | materials | Derived from the resolved creature |
| Harvesting → Harvest DC | materials | |
| Harvesting → Biome | herbs | |
| Harvesting → Shelf Life | food ingredients | Arcadia 11's short / medium / long bands |
| Crafting → Crafter | craftables | Alchemist, Artificer, Blacksmith, Cook, Leatherworker, Thaumaturge, Tinker |
| Crafting → Crafting DC | craftables | Cooking DC for dishes |
| Crafting → Rarity | craftables | |
| Crafting → Variant Component For Spell | spell components | Arcadia 8 components, indexed by spell |
| Value, Weight | materials, craftables | Value is in copper, displayed as coins |
| Miscellaneous | all | Has Mechanical Effect, Has Use Effect, Requires Preparation, Craftable From, Has Ingredients, Has Structured Spell Effects, Appears In Multiple Books |

Clicking any effect tag in a stat block applies that Effect filter immediately.

## Search

The search box matches **names and list metadata** — deliberately, so that searching `dragon`
surfaces Dragon Blood rather than burying it under every entry whose description mentions dragons.

To search the prose itself, use a command prefix:

| Command | Searches |
|---|---|
| `text:"query"` | everything below, plus fluff |
| `stats:"query"` | name, entries, dish outcomes, ingredients, harvest info, linked recipes, variant-component spell effects, effect tags |
| `name:"query"` | name only |
| `ingredient:"query"` | what a craftable consumes — the one axis with no equivalent filter |

Wrap a query in `/slashes/` for a regex, or add `!` (`text:! query`) to invert it.

Two things this page indexes that the stock 5etools syntax does not:

- **Dish outcomes.** The Arcadia 11 dishes keep flavour text in `entries` and the actual benefit in
  `outcomes`, so `A Perfect Roast` reads "Any bonehead can throw a deer on a spit" in prose and
  "You gain 5 temporary hit points" in structured data. Indexing `entries` alone makes every dish
  unsearchable by what it does.
- **Tag targets.** `Renderer.stripTags` keeps only a tag's display text, so
  `{@condition exhaustion|PHB|exhausted}` would index as "exhausted" and a search for the
  condition's own name would miss it. Both spellings are indexed.

Indexing is lazy and memoised per row: it costs nothing until a text search is actually run, then
roughly 100 ms once to index all ~2,375 entries (~1.5 MB) and ~1 ms per query after that.

**If a plain search finds nothing** but the text search would find something, the page says so and
offers the full-text search with the number of results it would return, honouring whatever filters
are active. That is how most people will discover the syntax exists.

## Cross-links

The generator builds a bidirectional material ↔ craftable graph, so:

- a **material** stat block lists every craftable it feeds into (internal links where the target
  is modelled, `{@item}` links where it points at a DMG/PHB item);
- a **craftable** stat block links each ingredient back to the material entry;
- both link to their source creature in the bestiary;
- materials described in more than one book get an "Also described in …" line rather than being
  silently merged.

## Tools

### Harvest Lookup

Pick a creature, get every harvestable part from **all six books** merged into one table sorted by
DC — with quantity, harvest time, value, weight, what it crafts into, and which book it came
from. This is the "what do I get off this corpse?" answer that otherwise requires flipping through
three handbooks and an Arcadia issue.

Implemented in `js/crafting/crafting-harvest-lookup.js`.

### Crafting Planner

Select craftables — or pin them to the sublist first, and the planner opens pre-populated — and
get an aggregated shopping list: total quantity of each material, its harvest DC, which creature
or biome it comes from, its value, and which craftable needs it. Plus totals for material count,
known value, and highest harvest DC.

Implemented in `js/crafting/crafting-planner.js`.

## File map

| Path | Role |
|---|---|
| `crafting.html` | Page shell |
| `js/crafting.js` | `ListPage` controller + sublist manager |
| `js/filter-crafting.js` | `PageFilterCrafting` + `ListSyntaxCrafting` (full-text search) |
| `js/render-crafting.js` | Full stat blocks for the three entity types |
| `js/crafting/crafting-harvest-lookup.js` | Harvest Lookup tool |
| `js/crafting/crafting-planner.js` | Crafting Planner tool |
| `scss/crafting.scss` → `css/crafting.css` | Styles |
| `node/generate-crafting-data.js` | Data generator entry point |
| `node/generate-crafting-data/` | Generator helpers, one module per source family |
| `data/crafting.json` | Generated data (committed) |
| `data/crafting-effect-overrides.json` | Hand-curated effect-tag corrections |

`Renderer.crafting.getCompactRenderedString` in `js/render.js` provides the compact stat block
used by hover previews and site-wide search.
