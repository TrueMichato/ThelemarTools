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

## Backup document proof

All 52 backup documents are read, including documents with no item content. Raw totals are 881 items, 101 base items, 116 variant templates, and 58 item groups. Backup variants generate 2637 concrete candidates before global deduplication; 3457 globally deduplicated entities are credited to backup documents.

| # | Document | Item | Base | Variant | Group | Expanded | Full | Surfaced | Unsupported |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Book of Hordes | 12 | 0 | 0 | 1 | 0 | 0 | 13 | 0 |
| 2 | Major NPCs | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | Abyssal Horrors | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 4 | Ankheg Catalogue | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 5 | Badooga's Exploration Guidelines | 5 | 0 | 0 | 0 | 0 | 0 | 5 | 0 |
| 6 | Badooga's Monster Guidelines | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 7 | Better Greatwyrms | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 8 | Elder Evils | 7 | 0 | 0 | 0 | 0 | 2 | 5 | 0 |
| 9 | Libris Mortis | 56 | 0 | 10 | 0 | 483 | 252 | 271 | 0 |
| 10 | Monsters of the Apocalypse | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 11 | Conflux Creatures | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 12 | Conflux's Zombies | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 13 | 35 Versatile NPCs | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 14 | Monsters of the Infinite Planes | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 15 | NPC Collection Blog | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 16 | Expanded Racial Feats | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 17 | Dragonix's Deadly Denizens 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 18 | Monster Manual Expanded (v1) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 19 | Monster Manual Expanded - 2024 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20 | Monster Manual Expanded II (v2) | 0 | 0 | 1 | 0 | 5 | 5 | 0 | 0 |
| 21 | Monster Manual Expanded III | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 22 | Dungeon Dad Statblocks | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| 23 | Monsters and Myths | 15 | 0 | 0 | 0 | 0 | 3 | 12 | 0 |
| 24 | Eighteen Sons of the Lightning Lord | 58 | 32 | 1 | 0 | 114 | 1 | 120 | 0 |
| 25 | Honourable Heroes | 8 | 41 | 0 | 0 | 0 | 1 | 0 | 0 |
| 26 | Fifth Edition Foes | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 27 | Grim Hollow - Monster Grimoire - 2024 | 80 | 1 | 6 | 1 | 158 | 152 | 81 | 0 |
| 28 | Grim Hollow - The Monster Grimoire | 80 | 1 | 6 | 1 | 180 | 149 | 106 | 0 |
| 29 | Monsters of Drakkenheim | 49 | 0 | 15 | 1 | 591 | 441 | 194 | 0 |
| 30 | Monsters of the Guild | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 31 | The Griffon's Saddlebag, Book 1 - 2024 | 359 | 0 | 29 | 4 | 450 | 486 | 309 | 0 |
| 32 | Melvin's Minute Monsterium: Swamps & Sewers | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 33 | Creature Codex | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| 34 | Tome of Beasts 2 Lairs | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| 35 | Tome of Beasts 3 Lairs | 9 | 1 | 0 | 0 | 0 | 1 | 3 | 0 |
| 36 | Tome of Beasts 3 | 6 | 0 | 1 | 0 | 17 | 17 | 3 | 0 |
| 37 | 5 High Level Villains | 3 | 0 | 0 | 0 | 0 | 3 | 0 | 0 |
| 38 | 5 Low Level Villains | 3 | 0 | 0 | 0 | 0 | 2 | 1 | 0 |
| 39 | Heliana's Guide to Monster Hunting | 92 | 25 | 47 | 50 | 639 | 311 | 469 | 0 |
| 40 | Lovecraftian Monsters | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 41 | Essential NPCs | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 42 | The Seven Dragon Overlords | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 43 | Ultimate NPCs Skulduggery | 30 | 0 | 0 | 0 | 0 | 3 | 27 | 0 |
| 44 | The Dreaded Accursed | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 45 | Pathfinder - Kingmaker Bestiary (5e) | 3 | 0 | 0 | 0 | 0 | 2 | 1 | 0 |
| 46 | Monster a Day Compendium | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 47 | Travelers Guide to Thelemar Monsters | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 48 | Outclassed - The NPC Statblock Compendium | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 49 | Errata Spellcasters | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 50 | Sword Coast Legends NPCs | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 51 | Wizards copy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 52 | Catastrophic Dragons | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

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
