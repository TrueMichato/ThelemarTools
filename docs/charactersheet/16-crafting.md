# Crafting, Harvesting & Cooking

The character sheet's crafting subsystem. Materials live in the Inventory; harvesting, crafting and
cooking are modal flows launched from the Inventory tab and the play-mode Actions hub.

The reference side of the same data lives at [`crafting.html`](../crafting/README.md), and both
surfaces read the **same generated file**, so they can never disagree about what a material is.

## Three flows, two of which roll dice

**Only 19 of 456 craftables have a DC** — the Arcadia 11 dishes. The Complete Crafter defines the
other 437 as *resources and time*: raw materials worth half the item's selling cost, `gp ÷ 50`
workweeks, and the right tool proficiency. Rolling for those would invent a rule none of the six
books contain.

| Flow | Check | Resolution |
|---|---|---|
| **Harvest** | Dexterity (Harvesting) vs the material's DC | Success adds the material to inventory |
| **Cook** (19 dishes) | Wisdom (Cooking) vs `craftDC` | Meets DC → Success · +5 → Delicious · natural 20 on a success → Extra Delicious |
| **Craft** (437 items) | *none* | A commit dialog: materials, tool advisory, workweeks → consume → produce |

## The two invariants

### 1. Materials are inventory items, not a parallel ledger

Crafting consumes through the same `setItemQuantity` / `removeItem` calls the variant-component
cast picker reads. An Aboleth Eye spent on a Lens of Forgotten History disappears from the cast
picker with **no code in between** — there is nothing to synchronise because nothing is separate.

Any change that introduces a private material store will desync from casting the moment anyone
touches it. `test/jest/charactersheet/CharacterSheetVariantComponentInvariant.test.js` locks this,
including the exact ×3 → craft → ×2 sequence.

### 2. Every roll goes through `_rollSkillCheck`

`_rollSkillCheck(skillKey, name, event, overrideAbility, {dc})` returns
`{total, roll, mode, isSuccess, isNat20, isNat1}` and annotates the result modal with the verdict.

A local `Math.random()` would look identical and be quietly wrong: it drops conditional modifiers,
exhaustion, advantage from active states, 3D dice and roll history. Quantity rolls (`1d4 teeth`) go
through `page.rollDice` for the same reason.

## The dual-role problem

Some materials are *both* a crafting material and a spell component, and the books disagree about
them:

| | `Aboleth Eye \| Ar8` | `Aboleth Eye \| HHHVI` |
|---|---|---|
| Harvest DC | 17 | 20 |
| Quantity | ×3 | ×1 |
| Weight | 0.5 lb | 45 lb |
| Value | — | 375 gp |
| Does | enhances *legend lore* | crafts a **Lens of Forgotten History** |

It is one physical object, so the player owns **one**, and `setCraftingCatalog` merges them using
the `alsoIn` links the generator emits (~20 of 141 components have a twin).

- **Arcadia 8 has precedence** — it owns identity, weight and `variantComponent`. Applying the
  twin's 45 lb would silently rewrite a character's encumbrance.
- The twin contributes **only what Arcadia 8 lacks**: `usedInRecipes`, trade value, an alternative
  harvest DC. Those appear under `printings` for disclosure, never applied.
- **Category:** `_isVariantComponent` is tested first, so it groups under **Spell Components** (🧪)
  and carries a second **Material** badge — the material role is disclosed, not hidden.
- The **Harvest modal shows both rows**, source-labelled and marked "also in another book". Either
  roll fills the same stack.

## Where the code lives

| Path | Role |
|---|---|
| `js/charactersheet/charactersheet-crafting.js` | All three flows |
| `charactersheet-state.js` → `setCraftingCatalog` | Indexing and the twin merge |
| `charactersheet-state.js` → `normaliseMaterialKey` | The name key that makes an Ar8 eye satisfy a `\|hhhvi` ingredient |
| `charactersheet.js` → `pGetCraftingCatalog` | Lazy loader (see below) |
| `charactersheet-inventory.js` → `_getItemCategory` | Spell Components / Crafting Materials grouping |
| `charactersheet-playmode.js` → `_renderCrafting` | Actions hub card |
| `css/charactersheet.css` → `.cs-crafting__*` | Styles |

### Lazy loading

`data/crafting.json` is ~2.5 MB — an order of magnitude larger than anything else the sheet loads,
and most characters never harvest. It is **not** in the initial `Promise.all`; `pGetCraftingCatalog()`
fetches it on first use and caches the promise, so concurrent callers share one request and a
failed load is not retried in a loop. A failure is non-fatal: the flows show an empty state.

## Settings

Under **Crafting & Harvesting** in the settings modal. Backfilled for older saves by
`_migrateCraftingSettingsDefaults()` — `settings` merges shallowly on load, so an old save's object
replaces the default wholesale and these keys would otherwise arrive `undefined`.

| Setting | Default | Effect |
|---|---|---|
| `enableCrafting` | on | Master toggle; hides the Inventory buttons and the Actions hub card |
| `craftingDangerousHarvest` | off | Hamund's optional rule: botching a venom or breath sac turns it on you |
| `craftingStrictCrafterGating` | off | Block craftables you lack the profession for. Off by design — the sheet advises, the DM decides |
| `craftingConsumeOnFailure` | off | For tables that houserule a crafting check; no source book defines one |

## Components with a menu of uses

Most variant components do one thing. **Distilled dragon's blood** is the exception: it carries all
twelve of [The Twelve Uses of Dragon's Blood](../../homebrew/TravelersGuidetoThelemar.json)
(a canonical TGTT `variantrule`), and its potency decides how many you may invoke at once —
1 for a wyrmling's blood, 4 for an ancient's.

That is modelled as data, not prose:

```jsonc
"variantComponent": {
  "usesPerCasting": 4,
  "uses": [
    {"key": "farFlung", "name": "Far-Flung", "entry": "Double the spell's range."},
    // …twelve in canonical order
  ],
  "spellEffects": [{"match": {"any": true}, /* … */}]
}
```

When a chosen component declares `uses`, `_pChooseComponentUses` in `charactersheet-spells.js`
prompts for that many — the first pick is mandatory (it is the point of spending the vial), and a
*"Done — invoke only N"* option appears once at least one is chosen. The selections ride the cast on
`variantComponent.uses` and are rendered as effects.

Any component can adopt this by adding a `uses` array; nothing is dragon-specific in the code.

## Advisories, never blocks
- **Crafter profession → tool.** Blacksmith → Smith's Tools, Alchemist → Alchemist's Supplies,
  Cook → Cook's Utensils, and so on. Shown as a chip, green when proficient, amber when not.
- **Hamund's Crafter Skill rule.** Proficiency bonus should reach the item's rarity (+2 common
  through +6 legendary). Shown as a `Prof +N` chip when short.
- **Last component.** When a craft would consume the final unit of something that is also a spell
  component: *"This is your last Aboleth Eye; it also enhances Legend Lore."*

None of these prevent the action. The commit dialog offers **Craft / Craft anyway / Cancel**,
mirroring the Scribe Spell modal, so a player is never trapped by advice they disagree with.

## Rules sourcing

| Decision | Source |
|---|---|
| Harvesting is **Dexterity**-based | Arcadia 11 p23 — corrected from the sheet's earlier unsourced Wisdom mapping, in both `charactersheet-state.js` and the DM Screen's Party Tracker so a character's modifier matches in both |
| Cooking is **Wisdom**-based | Arcadia 11 p23 |
| Success / Delicious / Extra Delicious | Arcadia 11 `SimRep` / `SpeRep` item properties |
| Materials at half sell cost, `gp ÷ 50` workweeks | The Complete Crafter, "Crafting an Item" |
| Proficiency bonus vs rarity | Hamund's, "Optional Rule: Crafter Skill" |
| Failed harvest of a damaging material | Hamund's, "Optional Rule: Harvesting Dangerous Materials" |
| The Twelve Uses of Dragon's Blood | TGTT, a canonical `variantrule` — Arcadia 8's raw `Dragon Blood (…)` entries are the narrow, undistilled form and are preserved unchanged |

## Adding to the data

Never hand-edit `data/crafting.json` — it is generated. Edit the source (a homebrew book, or
`data/items-variant-components-ar8.json`), then run `npm run gen:crafting`.

`test/jest/CraftingDataFreshness.test.js` regenerates and diffs against the committed file, so
forgetting that step fails loudly instead of leaving the sheet disagreeing with `crafting.html`.

## Tests

| Suite | Covers |
|---|---|
| `CharacterSheetVariantComponentInvariant.test.js` | Casting never reads categorisation; the shared-stack rule |
| `CharacterSheetCraftingCatalog.test.js` | Indexing, name normalisation, the twin merge — including against the real generated data |
| `CharacterSheetCrafting.test.js` | Readiness, consumption, alternatives, quantity rolls, advisories, the cooking ladder |
| `CraftingDataFreshness.test.js` | `data/crafting.json` matches its sources |
