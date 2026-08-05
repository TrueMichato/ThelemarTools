# Character Sheet Magic-Item Coverage Audit

The audit expands repository and homebrew magic variants into the concrete items players see, deduplicates by `name|source`, and classifies mechanics using the production item normalizer plus known downstream structured consumers.

## Full backup snapshot

The full snapshot includes repository items, base items, concrete magic-variant expansions, and all item content in the 52 homebrew documents from the supplied site backup.

| Legacy headline | Concrete entities | Share |
| --- | ---: | ---: |
| Fully functional | 5,423 | 45.3% |
| Surfaced only | 6,536 | 54.7% |
| Unsupported | 0 | 0.0% |
| **Total** | **11,959** | **100%** |

The stricter operational audit remains below the previous optimistic 6,100-item count. This is intentional: field presence no longer proves functionality. Items with bare charges, unresolved choices, reference-only powers, or a working passive plus an unresolved active clause remain surfaced.

| Operational status | Items | Share |
| --- | ---: | ---: |
| `structuredOperational` | 4,932 | 41.2% |
| `proseOperational` | 491 | 4.1% |
| `partiallyOperational` | 1,815 | 15.2% |
| `choiceRequired` | 1,218 | 10.2% |
| `resourceOnly` | 226 | 1.9% |
| `referenceOnly` | 779 | 6.5% |
| `bespoke` | 2,498 | 20.9% |
| `invalidShape` | 0 | 0.0% |

## Classification contract

- **`structuredOperational`:** a supported structured field reaches a known sheet consumer, or a structured attached spell becomes an operational item power.
- **`proseOperational`:** production normalization derives an operational effect, rider, or power from a supported prose family.
- **`partiallyOperational`:** at least one mechanic works, but an unresolved choice, active clause, or reference-only power remains.
- **`choiceRequired`:** structured metadata is insufficient until the player selects its concrete meaning, such as the spell bound by `spellScrollLevel`.
- **`resourceOnly`:** charges exist without an operational power, or their maximum requires resolution.
- **`referenceOnly`:** the sheet surfaces a power but cannot safely execute its mechanics.
- **`bespoke`:** rules text is visible but no safe operational mechanic is available.
- **`invalidShape`:** an unknown attached-spell shape or an entity with neither mechanics nor rules text.

The legacy headline remains for historical comparison. Only `structuredOperational` and `proseOperational` count as fully functional. Partial, choice, resource, reference, and bespoke outcomes count as surfaced.

`spellScrollLevel` items now have a deterministic configuration path: adding one from the inventory catalog requires selecting an exact-level spell, persists that selection on the item, and normalizes it into a charged Enspelled power or a finite scroll power. Unconfigured corpus templates remain `choiceRequired`, so this capability does not inflate the headline before a concrete spell is selected.

Structured item resources now use one runtime contract. Numeric maxima remain fixed, dice maxima such as `{@dice 1d8 + 1}` are rolled once when an item instance is created and persisted, and proficiency-bonus maxima resize with the character without refilling spent charges. Invalid formulas remain explicitly unavailable instead of being truncated by `parseInt`. `attachedSpells.resource` spends its named character resource atomically, while a missing `resourceName` is surfaced as unresolved. `recharge: "special"` remains manual and is never restored by a rest.

The remaining structured adapters add 255 fully functional entities (+2.1 percentage points). Structured `light` becomes a persisted on/off item power feeding the sheet's emitted-light display; `focus` participates in material-component validation for the listed classes; fixed language grants are derived only from wearer-directed rules text, while ambiguous grants require a persisted language choice; `ability.choose` uses persisted per-item selections; and numeric weapon `reach` feeds attack range. Choice-configured copies remain distinct inventory stacks.

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
