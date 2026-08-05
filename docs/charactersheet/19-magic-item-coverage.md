# Character Sheet Magic-Item Coverage Audit

Snapshot generated from the in-repo site catalog and every item document in the supplied 5etools site backup. Unlike the earlier template-level audit, this audit expands magic variants into the concrete items players see on the Items page and deduplicates the result by `name|source`.

| Status | Concrete entities | Share |
| --- | ---: | ---: |
| Fully functional | 6100 | 51.0% |
| Surfaced only | 5859 | 49.0% |
| Unsupported | 0 | 0.0% |
| **Total** | **11959** | **100%** |

The previous audit counted 2659 items and variant templates, with 1242 (46.7%) classified as functional. Concrete expansion and complete backup ingestion add 9300 audited entities and 4858 functional results, while increasing the functional share by 4.3 percentage points.

## Corpus and expansion methodology

The repository input is `data/items.json`, `data/items-base.json`, and `data/magicvariants.json`. The backup input is all 52 documents in `async.HOMEBREW_2_STORAGE`, including 881 `item`, 101 `baseitem`, 116 `magicvariant`, and 58 `itemGroup` records before filtering and deduplication.

Each repository or backup variant is applied to every compatible repository or backup base item using the renderer's edition, `requires`, and `excludes` rules. The audit then applies inherited fields and `{=prop}` substitutions, and counts each resulting `name|source` once. This produces 6859 repository-variant expansions plus additional expansions attributed to their originating backup documents. The total is higher than the approximate 5000 visible-item estimate because the combined corpus permits backup variants to match both repository and backup base items.

| Largest corpus groups | Full | Surfaced | Total |
| --- | ---: | ---: | ---: |
| Repository variant expansions | 3470 | 3389 | 6859 |
| Repository magic items | 795 | 848 | 1643 |
| Heliana's Guide variant expansions | 249 | 390 | 639 |
| Monsters of Drakkenheim variant expansions | 431 | 160 | 591 |
| Libris Mortis variant expansions | 239 | 244 | 483 |
| Griffon's Saddlebag variant expansions | 332 | 100 | 432 |
| Griffon's Saddlebag items | 154 | 205 | 359 |

## Structured mechanics covered

The largest mechanically recognized families in the expanded corpus are:

| Field family | Concrete entities |
| --- | ---: |
| `bonusWeapon` | 4147 |
| `charges` | 2416 |
| Derived weapon rider | 1342 |
| `attachedSpells` | 1320 |
| `resist` | 618 |
| `bonusAc` | 440 |
| `bonusSpellAttack` | 402 |
| `bonusSpellSaveDc` | 377 |
| `modifySpeed` | 203 |
| `ability` | 81 |
| `bonusSavingThrow` | 70 |

## Classification contract

- **Fully functional:** mechanics use a supported structured field, attached-spell shape, or resource-backed/destructive active-power block.
- **Surfaced only:** rules text remains visible, but no safe structured operation can be inferred.
- **Unsupported:** the entity has an unknown attached-spell shape or neither mechanics nor rules text.

The audit is deliberately conservative and is a static shape classifier, not an automated playthrough of every item. "Surfaced only" means the player can read the complete item rules, but the sheet does not claim to resolve bespoke prose. Prose-derived powers without a charge/use transaction or destructive consequence render as non-interactive rules references. Cooldown-limited structured effects remain reference-only instead of becoming false always-on bonuses.

Repeating action powers with a clear dawn/long-rest reset normalize into shared use tracking (for example, Dagger of Venom and all Bag of Tricks variants). Limited, daily, rest-based, at-will, ritual, charge-based, and other attached-spell forms are supported. Daily groups share uses unless the data uses the `e` suffix ("each"), rest groups refresh on either rest, and finite `limited` groups never refresh automatically. Backup prose that assigns different charge costs to spells in one `attachedSpells` array is normalized per spell; per-spell dawn lockouts and reaction/rest powers are tracked independently.

Catalog-backed regressions cover the high-frequency enhancement, ability-setter, protection/luck, resistance/immunity, speed, senses, spell-focus, charged-spell, and weapon-rider families. Conditional AC bonuses such as Bracers of Defense are evaluated against live armor and shield state instead of being treated as unconditional `bonusAc`. Toggleable structured speed properties such as Boots of Speed apply only while their item power is active. Variable-charge spell wands expose a charge/slot-level choice and spend the selected amount atomically. Weapon prose normalizes standing riders (Frost Brand), toggleable riders (Flame Tongue), target-conditional riders (Dragon/Giant Slayer), and natural-20 riders (Vicious/Sword of Sharpness).

Run the in-repo catalog audit:

```bash
node node/audit-character-sheet-items.js
```

Include a 5etools export containing `async.HOMEBREW_2_STORAGE`:

```bash
node node/audit-character-sheet-items.js path/to/5etools-export.json
```
