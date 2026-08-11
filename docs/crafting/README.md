# Crafting &amp; Harvesting Hub

`crafting.html` is a single searchable, filterable reference covering every harvestable
material, craftable output, and crafting rule across six source books — plus two interactive
tools for the questions those books make hardest to answer.

| Doc | Covers |
|---|---|
| [01-overview.md](01-overview.md) | What the page does, the three entity types, filters, and the two tools |
| [02-data-model.md](02-data-model.md) | The `craftingMaterial` / `craftingRecipe` / `craftingRule` shapes |
| [03-generator.md](03-generator.md) | How `data/crafting.json` is produced, and how to regenerate it |
| [04-effect-tags.md](04-effect-tags.md) | The effect-tag taxonomy and how to correct a mis-tagged entry |
| [05-item-materials.md](05-item-materials.md) | The `itemMaterial` (MTL) entity — the 72 Thelemar item materials, their six axes, rendering, filters, and the duplicate-entity trap |
| [../charactersheet/16-crafting.md](../charactersheet/16-crafting.md) | The character sheet's harvest / craft / cook flows, which read the same data |

## Quick facts

- **Data**: `data/crafting.json`, generated — never hand-edit it.
- **Regenerate**: `npm run gen:crafting` (or `npm run gen`, which includes it).
- **Corrections**: `data/crafting-effect-overrides.json`.
- **Source books**: Hamund's Harvesting Handbook I/II/III, Hamund's Herbalism Handbook,
  Arcadia Issue 8, Arcadia Issue 11, The Complete Crafter, Traveler's Guide to Thelemar.
- **Scale**: ~1,875 materials, ~456 craftables, 44 rules, 72 item materials.
