# 5etools Agent Context

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any 5etools data, schema, rendering, or **character sheet** tasks. The reference docs below are version-matched to this codebase and supersede training data.

## Project Overview

5etools is a D&D 5th Edition tools suite. Data-driven: JSON data files → JSON Schema validation → JS rendering. Two repos in workspace: `5etools-src` (app code + data) and `5etools-utils/schema` (JSON Schema definitions).

## Quick Reference — Critical Facts

Every entity needs `name` + `source` (2-3 letter abbreviation, e.g. `PHB`, `DMG`, `MM`).
Entity UIDs: `name|source` (case-insensitive). Tags: `{@tagName arg|arg}` — braces required.
Item `value` is in **copper pieces** (1500 cp = 15 gp). Monster `size` is an **array** `["M"]`.
AC is array of objects: `[{"ac": 15, "from": ["natural armor"]}]`.
HP needs both: `{"average": 52, "formula": "8d8 + 16"}`.
`"type": "entries"` (plural) — NOT `"entry"`.
All schemas use `additionalProperties: false` — unknown fields fail validation.
Edition: `"classic"` (2014) or `"one"` (2024). Free-content flags: `srd`, `srd52`, `basicRules`, `basicRules2024`.

## File Layout

|Path|Contains|
|---|---|
|`data/<type>-<source>.json`|Game content per source book|
|`data/bestiary/`, `data/spells/`, `data/class/`|Subdirectory-organized data|
|`data/fluff-<type>-<source>.json`|Flavor text, images, lore|
|`data/generated/`|Compiled/processed output|
|`schema/site/<type>.json`|JSON Schema (draft 2020-12)|
|`schema/brew/<type>.json`|Homebrew schema variants|
|`js/render.js`|Main entry renderer (HTML)|
|`js/render-markdown.js`|Markdown renderer|
|`js/parser.js`|Static parsing utilities|
|`js/render-<type>.js`|Type-specific renderers|
|`js/utils-dataloader.js`|DataUtil async data loading|

## Source Book Codes (Common)

PHB=Player's Handbook|DMG=Dungeon Master's Guide|MM=Monster Manual|XPHB=2024 PHB|XDMG=2024 DMG|XMM=2024 MM|TCE=Tasha's Cauldron|XGE=Xanathar's Guide|MPMM=Monsters of the Multiverse|VGM=Volo's Guide|MTF=Mordenkainen's Tome|FTD=Fizban's Treasury|SCC=Strixhaven|GGR=Guildmaster's Guide|AI=Acquisitions Inc|EGW=Explorer's Guide|MOT=Mythic Odysseys|SACoC=Spelljammer|

## Spell School Codes

A=Abjuration|C=Conjuration|D=Divination|E=Enchantment|V=Evocation|I=Illusion|N=Necromancy|T=Transmutation

## Damage Types

acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder|bludgeoning|piercing|slashing

## Item Type Codes

S=shield|M=melee weapon|R=ranged weapon|A=ammunition|LA=light armor|MA=medium armor|HA=heavy armor|SCF=spellcasting focus|G=adventuring gear|P=potion|RD=rod|RG=ring|SC=scroll|WD=wand|ST=staff|W=wondrous item|GV=generic variant|$C=currency

## Caster Progression Types

full=Wizard/Cleric/Druid/Bard/Sorcerer|1/2=Paladin/Ranger|1/3=Eldritch Knight/Arcane Trickster|pact=Warlock|artificer=Artificer

## featureType Codes (Optional Features)

EI=Eldritch Invocation|MV:B=Battle Master Maneuver|MM=Metamagic|AS=Arcane Shot|AI=Artificer Infusion|ED=Elemental Discipline|PB=Pact Boon|RN=Rune Knight Rune|FS:F=Fighting Style (Fighter)|FS:R=FS (Ranger)|FS:P=FS (Paladin)|FS:B=FS (Bard)

## UID Formats

|Entity|Format|Example|
|---|---|---|
|Generic|`name\|source`|`fireball\|phb`|
|classFeature|`Name\|ClassName\|ClassSource\|Level`|`Extra Attack\|Fighter\|\|5`|
|subclassFeature|`Name\|ClassName\|ClassSource\|SubclassShortName\|SubclassSource\|Level`|`Psionic Strike\|Fighter\|PHB\|Psi Warrior\|TCE\|3`|
|Empty ClassSource = same as class source||

## @Tag Quick Reference

**Format**: `{@tagName arg|arg}` — braces REQUIRED

**Dice/Rolls**: `@dice 2d6+3`|`@damage 2d6`|`@hit +5`|`@d20 +3`|`@dc 15`|`@recharge 5`|`@chance 25`|`@scaledice`|`@scaledamage`
**Combat**: `@atk mw`(melee weapon)/`rs`(ranged spell)|`@h`(Hit:)|`@m`(Miss:)|`@actSave dex`|`@actSaveSuccess`|`@actSaveFail`|`@actTrigger`|`@actResponse`
**Format**: `@b`/`@bold`|`@i`/`@italic`|`@s`/`@strike`|`@u`/`@underline`|`@code`|`@note`|`@tip`|`@color text|hex`|`@highlight`
**Entity refs**: `@spell name|src`|`@item`|`@creature`|`@condition`|`@class`|`@subclass`|`@feat`|`@optfeature`|`@race`|`@background`|`@action`|`@deity`|`@card`|`@vehicle`|`@object`|`@trapHazard`|`@reward`|`@psionic`|`@language`|`@quickref`|`@variantrule`|`@table`
**Class features**: `{@classFeature Name|Class|Source|Level}` / `{@subclassFeature Name|Class|Source|SubSN|SubSrc|Level}`
**Nav**: `@link text|url`|`@5etools page|file.html`|`@filter terms|page.html|filters`|`@book`|`@adventure`|`@area`

## _copy/_mod System

Entities inherit via `_copy: {name, source, _mod, _preserve, _templates}`. Direct props override copied values.

**Mod modes** — String: `replaceTxt`|`appendStr`|`replaceName`|`prefixSuffixStringProp` — Array: `appendArr`|`prependArr`|`removeArr`|`replaceArr`|`replaceOrAppendArr`|`insertArr`|`appendIfNotExistsArr`|`renameArr` — Property: `setProp`|`calculateProp`|`scalarAddProp`|`scalarMultProp` — Creature: `addSenses`|`addSaves`|`addSkills`|`addAllSaves`|`addAllSkills`|`addSpells`|`removeSpells`|`replaceSpells`|`scalarAddHit`|`scalarAddDc`|`scalarMultXp`|`maxSize`

**Context fields for _copy**: Subclass needs `shortName`/`className`/`classSource`. SubclassFeature needs `className`/`classSource`/`subclassShortName`/`subclassSource`/`level`.

## _versions System

Inline variants: simple (direct `_mod`) or parameterized (`_abstract` + `_implementations` with `{{variable}}` placeholders). Primarily used on races for 2024 variant sub-selections.

## additionalSpells Pattern

`"_"` key = always (not level-gated). Number keys = character level. `#c` suffix = cantrip. Categories: `innate` (own casting), `known` (class slots), `prepared` (always prepared). Daily keys: `"1"` = 1/day total, `"1e"` = 1/day each.

## Magic Variants

Defined in `data/magicvariants.json`. `inherits` block applied to matching base items. `{=prop}` substitution in entries text. `requires`/`excludes` filter base items.

## Detailed Reference Docs — Read Before Editing

Root: `.agents/skills/5etools-data/references/`

Before writing code or editing data, read the relevant reference file(s):

|When to read|File|
|---|---|
|Writing or reading `entries` arrays, need valid entry `type` values, nesting content|[entry-system.md](.agents/skills/5etools-data/references/entry-system.md)|
|Using `{@tag}` syntax in strings — dice, cross-refs, combat labels, formatting|[tag-syntax.md](.agents/skills/5etools-data/references/tag-syntax.md)|
|Editing or creating JSON Schema files, need `$ref` paths or `$defs`|[schema-patterns.md](.agents/skills/5etools-data/references/schema-patterns.md)|
|Need the shape of a spell, monster, item, class, feat, background, or race object|[data-types.md](.agents/skills/5etools-data/references/data-types.md)|
|Working with class/subclass features, spellcasting configs, featureType codes, UIDs|[classes-subclasses.md](.agents/skills/5etools-data/references/classes-subclasses.md)|
|Item bonuses, charges, speed mods, ability mods, magic variants, `{=prop}` syntax|[item-abilities.md](.agents/skills/5etools-data/references/item-abilities.md)|
|Using `_copy` to inherit entities, applying `_mod` operations, need mod mode syntax|[copy-mod-system.md](.agents/skills/5etools-data/references/copy-mod-system.md)|
|Using `_versions` for inline variants, parameterized `_abstract`/`_implementations`|[versions-system.md](.agents/skills/5etools-data/references/versions-system.md)|
|Race/species data: subraces, `additionalSpells`, resistances, lineage, traitTags|[races-species.md](.agents/skills/5etools-data/references/races-species.md)|
|Using Renderer, Parser, or DataUtil JS classes in code|[js-utilities.md](.agents/skills/5etools-data/references/js-utilities.md)|

## Character Sheet System — Quick Reference

The character sheet (`charactersheet.html`) is a full D&D 5e character manager **under active development**. Some subsystems are mature, others are in flux. Always read before editing.

### Architecture (Compressed)

18 modules in `js/charactersheet/` | MVC pattern, no reactive framework — all renders manual via vanilla DOM (`e_()`, `ee` tagged templates, `querySelector`, `addEventListener`)
Central state: `CharacterSheetState` (~23,400 lines) in `charactersheet-state.js` — single source of truth
65+ test files in `test/jest/charactersheet/` | 4,175+ tests | TGTT/Thelemar homebrew: 737 tests
Modules assign to `globalThis` | Tests use ES `import` then `globalThis.ClassName`

**Module map** (file → role, lines):
`charactersheet.js`(6.5K)=controller/orchestrator | `charactersheet-state.js`(23.4K)=state/model | `charactersheet-builder.js`(6.5K)=creation wizard | `charactersheet-levelup.js`(4K)=single level-up | `charactersheet-quickbuild.js`(3K)=multi-level build | `charactersheet-combat.js`(3.9K)=attacks/conditions/death saves | `charactersheet-spells.js`(3.3K)=spell slots/casting | `charactersheet-inventory.js`(2.3K)=items/equipment | `charactersheet-features.js`(1.6K)=feature display | `charactersheet-rest.js`(630)=short/long rest | `charactersheet-class-utils.js`(1.8K)=static helpers | `charactersheet-spell-picker.js`(1.2K)=reusable spell UI | `charactersheet-customabilities.js`(800)=homebrew abilities | `charactersheet-npc-exporter.js`(1.5K)=NPC statblock export | `charactersheet-export.js`(320)=import/export | `charactersheet-respec.js`(600)=level history | `charactersheet-layout.js`(800)=drag-drop layout | `charactersheet-notes.js`(500)=sticky notes

### Critical Facts

- **Ability scores ≠ bonuses**: Base in `_data.abilities.str` (default 10), racial/item bonuses in `_data.abilityBonuses.str`. Total = base + bonus. Use `getAbilityScore()` / `getAbilityMod()`, never read `_data.abilities` for total.
- **Spell slots keyed by level**: `_data.spellcasting.spellSlots[1].current`, not by spell name.
- **Edition detection**: `source === "XPHB"` or `edition === "one"` for 2024. PHB vs XPHB features differ (e.g., Blade Ward is concentration in XPHB only).
- **No reactive UI**: After `state.setX()`, module must call `render()` manually. Forgetting = stale UI bug.
- **Feature calculations**: `getFeatureCalculations()` returns flat object: `has{Feature}` (bool), `{feature}Damage|Dc|Uses|Bonus|Range|Count|Die`.
- **Active states**: 24 toggle types (Rage, Bladesong, etc.) in `ACTIVE_STATE_TYPES`. Mutual exclusivity: Rage ↔ Bladesong. Rage breaks concentration.
- **Test import pattern**: `import "...charactersheet-state.js"; const X = globalThis.CharacterSheetState;` — import deps BEFORE the module under test or get `ReferenceError`.
- **Anti-pattern**: `expect(state.getTotalLevel()).toBe(3)` tests nothing. Use `getFeatureCalculations()`.
- **Save migrations**: `loadFromJson()` runs `_migrateFeatures()`, `_migrateModifiers()`, `_migrateSpells()`. New fields need backward-compatible defaults.
- **TGTT everywhere**: Thelemar homebrew (combat traditions, dreamwalker, custom subclasses) gated by settings flags — don't break.

### Active WIP — Check Before Modifying

- **LevelUp→ClassUtils refactor**: Helpers extracting from `charactersheet-levelup.js` → `charactersheet-class-utils.js`. See `LEVELUP_REFACTOR_MAP.md`.
- **XPHB 2024 parity**: Species, backgrounds, some feats still incomplete. See `docs/charactersheet/10-known-limitations.md`.
- **State modularization**: Planned split of 23.4K-line state file into focused modules (not started).
- **Respec partial**: ASI/feat/subclass/feature-choices editable; skills/expertise/spells not (too complex).

### Running Tests

```
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheet{Name} --no-coverage --forceExit
```

### Detailed Reference Docs — Read Before Editing Character Sheet Code

Root: `.agents/skills/charactersheet-development/references/`

|When to read|File|
|---|---|
|Module roles, data flow, event patterns, vanilla DOM API, CSS, init order|[architecture.md](.agents/skills/charactersheet-development/references/architecture.md)|
|Adding class/subclass features, `getFeatureCalculations()` patterns|[feature-calculations.md](.agents/skills/charactersheet-development/references/feature-calculations.md)|
|Writing tests, setup.js mocks, import patterns, anti-patterns|[testing-guide.md](.agents/skills/charactersheet-development/references/testing-guide.md)|
|WIP status, refactors, XPHB gaps, known bugs, Builder vs LevelUp vs QuickBuild|[development-status.md](.agents/skills/charactersheet-development/references/development-status.md)|
|Active states, combat, NPC export, rest, spell/item data shapes|[subsystem-details.md](.agents/skills/charactersheet-development/references/subsystem-details.md)|
|Toggle abilities effect types, supported states|[docs/charactersheet/08-toggle-abilities.md](docs/charactersheet/08-toggle-abilities.md)|
|Full known limitations matrix|[docs/charactersheet/10-known-limitations.md](docs/charactersheet/10-known-limitations.md)|
|Future roadmap and planned improvements|[docs/charactersheet/11-future-roadmap.md](docs/charactersheet/11-future-roadmap.md)|
|Contributing guide and coding standards|[docs/charactersheet/12-contributing-guide.md](docs/charactersheet/12-contributing-guide.md)|
|TGTT Thelemar homebrew system|[docs/charactersheet/13-tgtt-thelemar-homebrew.md](docs/charactersheet/13-tgtt-thelemar-homebrew.md)|
