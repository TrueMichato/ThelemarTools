# Character Sheet Magic-Item Coverage Audit

Snapshot generated from the in-repo site catalog, magic-variant templates, TGTT homebrew, and the user-supplied 5etools homebrew export.

| Status | Items | Share |
| --- | ---: | ---: |
| Fully functional | 1166 | 43.9% |
| Surfaced only | 1493 | 56.1% |
| Unsupported | 0 | 0.0% |
| **Total** | **2659** | **100%** |

## Corpus breakdown

| Corpus | Full | Surfaced | Total |
| --- | ---: | ---: | ---: |
| Site catalog | 758 | 885 | 1643 |
| Magic-variant templates | 106 | 108 | 214 |
| TGTT | 19 | 3 | 22 |
| Supplied homebrew export | 283 | 497 | 780 |

The supplied export contains 21 homebrew documents with 780 magic items after excluding mundane entities. The largest sets are *The Griffon's Saddlebag, Book 1* (359), *Heliana's Guide to Monster Hunting* (91), the two *Grim Hollow Monster Grimoire* documents (74 each), and *Monsters of Drakkenheim* (43).

## Structured mechanics covered

| Field family | Items |
| --- | ---: |
| `attachedSpells` | 558 |
| `charges` | 480 |
| `bonusWeapon` | 363 |
| `resist` | 202 |
| `bonusAc` | 151 |
| `ability` | 83 |
| `bonusSpellAttack` | 60 |
| `modifySpeed` | 60 |
| `bonusSavingThrow` | 39 |
| `bonusSpellSaveDc` | 36 |
| `effects` | 21 |
| `immune` | 20 |
| `critThreshold` | 11 |
| `bonusWeaponAttack` | 10 |
| `vulnerable` | 9 |
| `conditionImmune` | 8 |
| `bonusSpellDamage` | 8 |
| `bonusWeaponDamage` | 4 |

## Classification contract

- **Fully functional:** mechanics use a supported structured field, attached-spell shape, or resource-backed/destructive active-power block.
- **Surfaced only:** rules text remains visible, but no safe structured operation can be inferred.
- **Unsupported:** the entity has an unknown attached-spell shape or neither mechanics nor rules text.

The audit is deliberately conservative. "Surfaced only" means the player can read the complete item rules, but the sheet does not claim to resolve bespoke prose. Prose-derived powers without a charge/use transaction or destructive consequence render as non-interactive rules references. Repeating action powers with a clear dawn/long-rest reset normalize into shared use tracking (for example, Dagger of Venom and all Bag of Tricks variants). Limited, daily, rest-based, at-will, ritual, charge-based, and other attached-spell forms are supported. Daily groups share uses unless the data uses the `e` suffix ("each"), rest groups refresh on either rest, and finite `limited` groups never refresh automatically.

Catalog-backed regressions cover the high-frequency enhancement, ability-setter, protection/luck, resistance/immunity, speed, senses, spell-focus, and charged-spell families. Conditional AC bonuses such as Bracers of Defense are evaluated against live armor and shield state instead of being treated as unconditional `bonusAc`. Toggleable structured speed properties such as Boots of Speed apply only while their item power is active.

Run the in-repo catalog audit:

```bash
node node/audit-character-sheet-items.js
```

Include a 5etools export containing `async.HOMEBREW_2_STORAGE`:

```bash
node node/audit-character-sheet-items.js path/to/5etools-export.json
```
