# Item Builder

The Item Builder authors canonical homebrew `item` entities from either the Homebrew Builder page or a compact DM Screen panel. Both surfaces use the same state, validation, and serialization core in `js/itembuilder/`.

## Authoring flow

1. Choose a catalog item as a preset.
2. Choose a compatible Thelemar item material.
3. Add compatible weapon or armor upgrades.
4. Optionally choose one gemstone empowerment.
5. Edit ordinary item fields and review the live statblock.
6. Save the result to the editable homebrew document.

The Homebrew Builder exposes the complete field set in grouped tabs. The DM Screen panel keeps preset, material, upgrades, and gemstone controls visible and opens the complete canonical item object through **Advanced fields**.

## Canonical item contract

The saved entity is a homebrew `item`, not a character-sheet inventory row. The serializer:

- retains a real `name`, `source`, `type`, and `baseItem`;
- materializes material, upgrade, and gemstone mechanics into normal item fields, `effects`, `itemPowers`, and generated `entries`;
- retains lightweight `material`, `appliedUpgrades`, and `socketedGemstones` provenance so the character sheet can resolve and edit the composition after import;
- rebuilds from the immutable preset plus current selections, preventing repeated edits from cumulatively applying the same bonus.

UI-only draft metadata is never written to the Brew entity.

## DM Screen persistence

The panel uses `PANEL_TYP_ITEM_BUILDER = 25`. Its versioned draft is returned by `getState()` and saved through `board.doSaveStateDebounced()`. Reloading a board restores the draft, including references which are temporarily unavailable; unresolved references are shown as warnings rather than silently discarded.

## Phase 2 boundary

Item materials, crafting materials, and crafting recipes require separate Homebrew Builder modes because each `BuilderBase` instance owns one entity property. Variant components will be nested authoring data. Generated `data/crafting.json` is never edited by the builder.
