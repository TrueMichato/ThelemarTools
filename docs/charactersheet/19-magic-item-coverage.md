# Character Sheet Magic-Item Coverage Audit

The audit expands repository and homebrew magic variants into the concrete items players see, deduplicates by `name|source`, and classifies mechanics using the production item normalizer plus known downstream structured consumers.

## Full backup snapshot

The full snapshot includes repository items, base items, concrete magic-variant expansions, and all item content in the 52 homebrew documents from the supplied site backup.

| Legacy headline | Concrete entities | Share |
| --- | ---: | ---: |
| Fully functional | 5,168 | 43.2% |
| Surfaced only | 6,791 | 56.8% |
| Unsupported | 0 | 0.0% |
| **Total** | **11,959** | **100%** |

The stricter operational audit reduces the previous 6,100-item functional count by 932. This is an intentional correction, not a product regression: field presence no longer proves functionality. Items with bare charges, unresolved choices, reference-only powers, or a working passive plus an unresolved active clause remain surfaced.

| Operational status | Items | Share |
| --- | ---: | ---: |
| `structuredOperational` | 4,655 | 38.9% |
| `proseOperational` | 513 | 4.3% |
| `partiallyOperational` | 1,838 | 15.4% |
| `choiceRequired` | 1,218 | 10.2% |
| `resourceOnly` | 238 | 2.0% |
| `referenceOnly` | 819 | 6.8% |
| `bespoke` | 2,678 | 22.4% |
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
