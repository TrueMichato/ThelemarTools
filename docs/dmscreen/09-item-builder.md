# Item Builder

The Item Builder authors canonical homebrew `item` entities from either the Homebrew Builder page or a compact DM Screen panel. Both surfaces use the same state, validation, and serialization core in `js/itembuilder/`.

## Authoring flow

1. **Base:** choose an item from core data or installed homebrew.
2. **Composition:** compare compatible materials, upgrades, and gemstone empowerments from any loaded source.
3. **Details:** name the item, choose where it is saved, and edit the fields relevant to its type.
4. **Review & Save:** inspect the resolved statblock, address validation, and save the reference-only item.

The Homebrew Builder and focused DM Screen editor use the same four-stage Forge model. The embedded DM Screen panel deliberately stays compact: it shows identity, composition, status, and primary actions only. **Open focused editor** provides category views, source/effect filters, selected-first results, compatibility details, the real item preview, advanced JSON, and Brew save controls.

**Saved under** identifies the editable homebrew document which owns the new item. **Published in** identifies the source of a selected base or component. These are intentionally separate: composing an item from several publications never changes where the resulting item is saved.

**Continue in Makebrew** stores a versioned one-shot draft and opens Makebrew in Item mode. Makebrew consumes and removes that handoff during initialization, restores the complete draft with a fresh editable ID, and saves it only to Makebrew's local draft state. The editable Brew document remains unchanged until the user explicitly saves.

## Canonical item contract

The saved entity is a homebrew `item`, not a character-sheet inventory row. The serializer:

- retains a real `name`, `source`, `type`, and `baseItem`;
- retains only lightweight, source-qualified `material`, `appliedUpgrades`, and `socketedGemstones` references;
- does not write preview-only bonuses, effects, powers, or generated entries into canonical Brew JSON;
- uses `ItemBuilderCore.projectForPreview()` to resolve a temporary display item from the immutable base and current selections;
- lets the character sheet resolve the same references after import or reload, so each mechanic is applied exactly once.

UI-only draft metadata is never written to the Brew entity.

## Source-agnostic mechanics

The base, material, upgrade, gemstone, and crafting-preset catalogs merge site data with installed Brew and deduplicate by `name|source`. Identity is always source-qualified; an upgrade named `Balanced|OTHER` cannot inherit the mechanics of `Balanced|TCAH`.

Current TCAH upgrades and TGTT gemstones are prose-only data, so their existing mechanics are preserved as built-in source-qualified descriptors. Other sources can provide structured item fields and effects, including attack, damage, AC, spell, save, and check bonuses; charges and recharge; attunement and focus; attached spells; item powers; and supported character-sheet effects. Unsupported prose remains visible but is never guessed into mechanics.

If a referenced source is temporarily unavailable, the selection is preserved and shown with recovery guidance. It remains mechanically inert rather than falling back to an entity with the same name from another source.

## DM Screen persistence

The panel uses `PANEL_TYP_ITEM_BUILDER = 25`. Its versioned draft is returned by `getState()` and saved through `board.doSaveStateDebounced()`. Reloading a board restores the draft, including references which are temporarily unavailable; unresolved references are shown as warnings rather than silently discarded.

The shared handoff contract lives in `js/itembuilder/itembuilder-handoff.js`. Malformed and unsupported drafts are removed rather than retried indefinitely, and Makebrew displays recovery guidance in the Item Builder status area.

## Crafting Workbench

Item materials, crafting materials, and crafting recipes remain separate Homebrew Builder modes because each `BuilderBase` instance owns one entity property. They share the numbered workbench, validation, advanced-data, preview, and review treatment. Crafting-material presets can come from site data, installed Brew, or the read-only Arcadia 8 variant-component adapter. Generated `data/crafting.json` is never edited by the builder.
