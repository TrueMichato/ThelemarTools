# Item Materials on the Crafting Page (`MTL`)

`itemMaterial` is the **fourth entity type** on `crafting.html`, alongside
`craftingMaterial` (MAT), `craftingRecipe` (CRF) and `craftingRule` (RUL).

It carries the 72 **Thelemar item materials** — what a thing is *made of* — as opposed to
`craftingMaterial`, which is what you *harvest or spend*. The two are deliberately separate
props: a bar of mithril is an input you buy; **Mithril** is a property a finished sword has.

| Prop | Abv | Count | Source |
|---|---|---|---|
| `itemMaterial` | MTL | 72 | `TGTT` — *Traveler's Guide to Thelemar* |

## Where the data comes from

Unlike the other three props, item materials are **not prose-lifted**. They are authored
once, already structured, in `homebrew/TravelersGuidetoThelemar.json` under an
`itemMaterial` array — the same file that carries `itemUpgrade`, `combatMethod` and
`divineFavor`.

`node/generate-crafting-data/extract-item-materials.js` is therefore a **pass-through
extractor**: it validates that each entry has a `name` and a `source` and copies it into
`data/crafting.json`. No parsing, no heuristics.

```
homebrew/TravelersGuidetoThelemar.json  ──┬──▶ brew merge ──▶ character sheet
        (single authored source)          │
                                          └──▶ extract-item-materials.js
                                                    │
                                              npm run gen:crafting
                                                    │
                                              data/crafting.json ──▶ crafting.html
```

> `data/crafting.json` is **generated — never hand-edit it.** Correct a material in the
> TGTT brew file and re-run `npm run gen:crafting`.

### The duplicate-entity trap

Because `itemMaterial` is registered in `PAGE_TO_PROPS[PG_CRAFTING]`, an installed TGTT
brew **also** surfaces its materials on the crafting page — on top of the generated copy.
Users with the brew saw all 72 materials twice.

`CraftingPage._addData()` overrides `ListPage._addData` and dedupes by lowercased
`name|source` across every prop before delegating. Generated data loads first and wins.

Both delivery paths are kept on purpose: dropping the generated copy would break the page
for users without the brew, and dropping the `PAGE_TO_PROPS` registration would break
third-party homebrew materials.

## Entity shape

See [`../charactersheet/21-item-materials.md`](../charactersheet/21-item-materials.md) for
the full field-by-field breakdown. The page-relevant summary:

| Field | Notes |
|---|---|
| `materialCategory` | `metal` `wood` `stone` `crystal` `cloth` `organic` `constructed` `condensate` |
| `density` | g/cm³, or `null` for *Varies* |
| `damage` `protection` `critical` `penetration` `magicCapacity` | The five axes. Tri-state: number / `"na"` / `null`. `magicCapacity` also takes `"infinity"` and `"-infinity"` |
| `rarity` | `common` … `legendary` |
| `price` | `{gp, unit, display, isPriceless, range?}`. Units: `lb` `vial` `stone` `matrix` `sqYard` `scale` `tooth` `heart` `sqFoot` `none` |
| `objectAc` | For the object-durability reference |
| `roles` | `strikingSurface` `protectiveLayer` `focus` |
| `appliesTo` | `weapon` `armor` `shield` `other` |
| `effects` | Structured effect list (33 types). An effect's `note` replaces the sheet's generated summary unless it carries `"noteMode": "qualifier"` |
| `magicCapacityRules` | Per-material MC exceptions (5 materials). Automated on the character sheet: `freeEffect` and `dcRiseThreshold` change the arithmetic, `opposedStatesCountAsOne` and `makerForeknowledge` are advisory |
| `degradation` | Wear rules (5 materials) |
| `entries` | Verbatim prose |

## Rendering

`_RenderItemMaterialImpl` in `js/render-crafting.js` produces the stat block:

1. **Axes strip** — five bordered cells (Damage / Protection / Critical / Penetration /
   Magic Capacity). Sentinels render as `N/A`, `∞`, `−∞` and *Varies*, and signed axes get
   an explicit `+`.
2. **Density** — with the derived weight multiplier relative to its category baseline.
3. **Price** — `price.display` verbatim, because trade units are heterogeneous.
4. **Object AC**, **roles**, **applies to**, **rarity**.
5. **Magic-capacity rules** and **degradation**, each rendered from a type→text map.
6. The prose `entries`.

Because trade units vary, `CraftingPage._getDisplayValue()` returns `price.display` for
`itemMaterial` rather than a coin total.

### The inline Draconic Domain Resonance table

Materials that carry a `draconicResonanceSlot` effect (Dragon Bone, Dragonhide, Dragon Scales,
Dragon Teeth and Claws) additionally print the **whole 18-row resonance table** — Fear first,
then Safety — between the magic-capacity rules and the degradation block.

Resonances are **reference data, not a fifth browsable prop**. They ride along in
`data/crafting.json` under a `draconicResonance` key, and `CraftingPage._addData()` stashes them
on `globalThis.__craftingDraconicResonances` instead of adding them to the list. That keeps the
page at four list entities while letting any material render the table.

> ⚠️ **Dedupe within the batch.** The generated dataset and an installed TGTT brew both carry
> the array, and 5etools merges the two *before* `_addData` runs — so the incoming
> `data.draconicResonance` can already hold each entry twice. The seen-set must grow as the loop
> walks the batch; deduping only against the previously-stashed array silently yields 36 rows.

## Filters

`js/filter-crafting.js` adds a **Material** MultiFilter:

- **Role** — striking surface / protective layer / focus
- **Applies To** — weapon / armor / shield / other
- Five **range filters**, one per axis (min −5, max 25, negatives allowed).
  `"infinity"` maps to 25, `"-infinity"` to −5, `"na"`/`null` to *no value*.

It also extends the shared filters:

- **Type** gains `itemMaterial`.
- **Category** gains the eight `ITEM_MATERIAL_CATEGORIES`. ⚠️ `groupFn` checks item-material
  categories **first**, because `"materials"` is simultaneously a crafting-rule category and
  loosely what item materials are.
- **Misc** gains `Has Mechanical Effect`, `Degrades In Use`, and `Priceless`.

## Registration checklist

If you add another prop to this page, this is the full set of touch points:

| File | Change |
|---|---|
| `js/parser.js` | `CRAFTING_PROP_TO_ABV`, `CAT_ID_ITEM_MATERIAL = 63`, `CAT_ID_TO_FULL`, `CAT_ID_TO_PROP`, `getPropDisplayName`, plus the `ITEM_MATERIAL_*` vocab tables and `itemMaterialAxisToFull()` |
| `js/utils.js` | `URL_TO_HASH_BUILDER`, `CAT_TO_PAGE`, `PAGE_TO_PROPS[PG_CRAFTING]`, `PROP_TO_PAGE`, and a `DataUtil.itemMaterial` config |
| `js/crafting.js` | `dataProps`, `_getDisplayValue`, the `_addData` dedupe |
| `js/render-crafting.js` | A `_Render*Impl` + a `_RENDER_BY_PROP` entry |
| `js/filter-crafting.js` | `_PROP_TO_ABV`, type filter item, `mutateForFilters`, `addToFilters`, `_pPopulateBoxOptions`, `toDisplay` |
| `node/generate-crafting-data.js` | Extractor call, dedupe, sort, output, run report |
| `scss/crafting.scss` | Any new stat-block styling (then `npx sass --style=compressed scss/crafting.scss:css/crafting.css`) |
| `crafting.html` | Nothing — the list is prop-driven |

## Regenerating

```bash
npm run gen:crafting     # or `npm run gen`
```

Expected counts in the run report:

```
craftingMaterial 1875 / craftingRecipe 456 / craftingRule 46 / itemMaterial 72 / draconicResonance 18
```

## The two Thelemar reference rules

Not every Thelemar rule belongs on the crafting hub, so `RULE_ALLOWLIST_BY_SOURCE.thelemar`
in `node/generate-crafting-data/extract-rules.js` is the *only* gate between the brew's 40
`variantrule` entries and the page. Two of them are material rules and are allowlisted into
the `materials` category:

| Rule | Contains |
|---|---|
| **Object Durability** | The 15-row Object AC table, the Tiny→Large fragile/resilient HP table, and the damage-type notes. Reference only — the sheet automates none of it. |
| **Magical Interference** | The d20-vs-`15 + overage` trigger, the passive-effect re-check rule, and the d8 effect table. |

⚠️ **The Magical Interference table exists twice.** The sheet rolls on
`CharacterSheetMaterials.MAGICAL_INTERFERENCE_TABLE`; the brew rule is the reader-facing
copy. `test/jest/CraftingItemMaterials.test.js` asserts the eight row names match the JS
constant in order, so the two cannot drift. Edit the JS constant and the brew together.

Adding a third reference rule means: author the `variantrule` in the brew, add its name to
the allowlist, and re-run `npm run gen:crafting`. Forget the allowlist and it silently never
appears.

## Related

- [`../charactersheet/21-item-materials.md`](../charactersheet/21-item-materials.md) — the
  sheet-side engine, projection, and UI
- [`01-overview.md`](01-overview.md) — the page as a whole
- [`03-generator.md`](03-generator.md) — the generator pipeline
