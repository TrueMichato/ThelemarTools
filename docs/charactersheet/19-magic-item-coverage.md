# Character Sheet Magic-Item Coverage Audit

The audit expands repository and homebrew magic variants into the concrete items players see, deduplicates by `name|source`, and classifies mechanics using the production item normalizer plus known downstream structured consumers.

## Full backup snapshot

The full snapshot includes repository items, base items, concrete magic-variant expansions, and all item content in the 52 homebrew documents from the supplied site backup.

| Legacy headline | Concrete entities | Share |
| --- | ---: | ---: |
| Fully functional | 5,540 | 46.3% |
| Surfaced only | 6,419 | 53.7% |
| Unsupported | 0 | 0.0% |
| **Total** | **11,959** | **100%** |

The stricter operational audit remains below the previous optimistic 6,100-item count. This is intentional: field presence no longer proves functionality. Items with bare charges, unresolved choices, reference-only powers, or a working passive plus an unresolved active clause remain surfaced.

| Operational status | Items | Share |
| --- | ---: | ---: |
| `structuredOperational` | 4,932 | 41.2% |
| `curatedOperational` | 5 | 0.0% |
| `proseOperational` | 603 | 5.0% |
| `partiallyOperational` | 1,824 | 15.3% |
| `choiceRequired` | 1,218 | 10.2% |
| `resourceOnly` | 225 | 1.9% |
| `referenceOnly` | 771 | 6.4% |
| `bespoke` | 2,381 | 19.9% |
| `invalidShape` | 0 | 0.0% |

## Classification contract

- **`structuredOperational`:** a supported structured field reaches a known sheet consumer, or a structured attached spell becomes an operational item power.
- **`curatedOperational`:** an exact item/source registry entry expands reusable typed templates into the same effect/power contracts.
- **`proseOperational`:** production normalization derives an operational effect, rider, or power from a supported prose family.
- **`partiallyOperational`:** at least one mechanic works, but an unresolved choice, active clause, or reference-only power remains.
- **`choiceRequired`:** structured metadata is insufficient until the player selects its concrete meaning, such as the spell bound by `spellScrollLevel`.
- **`resourceOnly`:** charges exist without an operational power, or their maximum requires resolution.
- **`referenceOnly`:** the sheet surfaces a power but cannot safely execute its mechanics.
- **`bespoke`:** rules text is visible but no safe operational mechanic is available.
- **`invalidShape`:** an unknown attached-spell shape or an entity with neither mechanics nor rules text.

The legacy headline remains for historical comparison. `structuredOperational`, `curatedOperational`, and `proseOperational` count as fully functional. Partial, choice, resource, reference, and bespoke outcomes count as surfaced.

`spellScrollLevel` items now have a deterministic configuration path: adding one from the inventory catalog requires selecting an exact-level spell, persists that selection on the item, and normalizes it into a charged Enspelled power or a finite scroll power. Unconfigured corpus templates remain `choiceRequired`, so this capability does not inflate the headline before a concrete spell is selected.

Structured item resources now use one runtime contract. Numeric maxima remain fixed, dice maxima such as `{@dice 1d8 + 1}` are rolled once when an item instance is created and persisted, and proficiency-bonus maxima resize with the character without refilling spent charges. Invalid formulas remain explicitly unavailable instead of being truncated by `parseInt`. `attachedSpells.resource` spends its named character resource atomically, while a missing `resourceName` is surfaced as unresolved. `recharge: "special"` remains manual and is never restored by a rest.

The remaining structured adapters add 255 fully functional entities (+2.1 percentage points). Structured `light` becomes a persisted on/off item power feeding the sheet's emitted-light display; `focus` participates in material-component validation for the listed classes; fixed language grants are derived only from wearer-directed rules text, while ambiguous grants require a persisted language choice; `ability.choose` uses persisted per-item selections; and numeric weapon `reach` feeds attack range. Choice-configured copies remain distinct inventory stacks.

**Activated speed items:** DMG and XDMG Boots of Speed grant `modifySpeed.multiply` only while equipped, attuned, and deliberately activated through their bonus-action item power. The Overview speed and its breakdown refresh when the power is toggled; unequipping or ending attunement turns the speed power off, so re-equipping requires another activation. A save with unrelated item powers but no speed toggle receives the catalog toggle on load, and the old XDMG reference-only card is replaced rather than duplicated. An authored custom item with `modifySpeed.multiply` but no speed power is intentionally passive while equipped/attuned.

**Custom-item editor fidelity (phase 1):** Create from a catalog item starts with a deep copy of its raw/normalized fields; Modify Item starts from the owned item's raw fields, not material-projected bonuses. Only differences from the form's initial draft are overlaid. An unchanged edit leaves the saved row alone, while clearing a visible bonus, material, defense, spell use, power, effect, or description clears that field without stripping unrelated catalog data. Nested entries and unknown fields survive unless their own control changes; the description field shows a readable text preview and warns that changing it replaces structured entries with plain text. Clones get a new inventory ID and do not inherit container links, Ioun-stone placements, generated-item ownership, or active toggle state; in-place edits retain wrapper identity, charges, attachments, upgrade/gem choices, and active power IDs. Changes to supported attached-spell uses also reconcile their derived powers, while other spell-grant shapes remain intact.

The existing power editor now preserves complete runtime descriptors, including `id`, `kind`, `isToggle`, `effectType`, action type, equipped requirement, resource keys, and an explicit **Reference only** choice. An authored reference-only charged or limited power remains a manual rules reference through edit, clone, and reload; its resources do not make its effect executable. Older powers without an explicit flag and prose-derived powers retain the existing operational resource inference. Both DMG and XDMG Boots clones retain one operational speed power through create, reload, and edit; changing their name cannot duplicate it. Removing that power while retaining its speed multiplier is rejected with an explanation instead of silently making the bonus passive. A custom speed multiplier without an operational speed power remains passive. Phase 1 did **not** add conditional damage controls or the grouped responsive editor; changing an existing item's type with incompatible catalog/power mechanics is blocked rather than guessing which fields to discard. Legacy array-style spell lists cannot be mixed with newly selected spell uses in this editor; they remain preserved on unchanged edits.

**Typed item damage (phase 2):** A weapon can carry independent `damageRiders[]` lines such as `{id: "acid-edge", dice: "1d6", damageType: "acid", conditions: {powerId: "ignite", criticalOnly: true, oncePerTurn: true, targetCreatureType: "dragon"}}`. Every condition present on a line must pass. `powerId` is the exact ID of a named, operational toggle on that item, not a power name or a request to use the first available toggle; it must be active on an equipped, attuned-if-required wrapper. Invalid dice, noncanonical damage types, ambiguous line IDs, and missing/reference-only/non-toggle power references cannot deal damage and appear in `getEffectiveItemBonuses(itemId).unresolvedDamageRiders` with a reason. A stable line ID is persisted when an item is added, replaced, or loaded; the runtime identity/turn receipt additionally includes the owned wrapper ID, so cloned copies cannot share a turn use. Legacy `requiresToggle` and `bonusDamageDice` remain operational and are never rolled a second time through the fallback.

Always-on dice roll on a normal hit and double on a critical hit; `criticalOnly` dice roll **once** on a crit and never on a normal hit. `oncePerTurn` is recorded only after a completed damage result using the state's shared turn-receipt ledger, cleared by the normal turn boundary, and not tracked outside combat. The single target-type prompt pools authored, material, and gemstone riders. Selecting **No qualifying type** excludes gated dice; dismissing the prompt cancels the entire damage roll before other prompts can spend resources or display a partial result. This phase provides the runtime contract for authored data and old saves; the grouped, responsive damage-line editor and its pre-Save form validation belong to phase 3.

The first conservative prose families add another 112 fully functional entities (+0.9 percentage points). Passive weapon critical thresholds, per-level maximum-HP bonuses, doubled carrying capacity, and doubled jump distance compile into typed effects consumed by combat, HP, encumbrance, and movement calculations. Structured fields take precedence, random-table outcomes are excluded, and target-facing or activated wording remains reference-only.

The curated registry adds five exact item/source definitions without item-name branches in downstream consumers. Registry entries reuse typed sense and skill templates, and explicit structured effects override a registry default. Homebrew authors can use the custom-item editor for both passive effects and active/reference powers; charged and limited powers share the runtime's atomic resource tracking, while untracked powers remain explicitly reference-only.

## Corpus methodology

Repository input is `data/items.json`, `data/items-base.json`, and `data/magicvariants.json`. With a backup argument, the audit also reads every document in `async.HOMEBREW_2_STORAGE`, including `item`, `baseitem`, `magicvariant`, and `itemGroup`.

Each variant is applied to compatible base items using edition, `requires`, and `excludes` rules. Inherited fields and `{=prop}` substitutions are resolved before global `name|source` deduplication. The production normalizer then derives item powers, passive effects, damage riders, critical riders, and conditional bonuses.

The audit is still a static operational contract, not a playthrough. Its statuses describe whether the sheet has an executable mechanic and whether unresolved rules remain; they do not claim that campaign-facing narrative effects can be automated.

## Running the audit

Repository catalog plus TGTT:

```bash
node node/audit-character-sheet-items.js
```

Full site backup:

```bash
node node/audit-character-sheet-items.js path/to/5etools-site-backup.json
```

The generated report includes headline totals, operational sub-statuses, corpus/document proof, structured-field counts, and classification reasons.
