# Development Status

Current state of the character sheet system — what's stable, what's in progress, what's known-broken.

## Contents
- Active Refactoring Efforts (LevelUp→ClassUtils, Builder/LevelUp/QuickBuild, Respec, State Modularization)
- XPHB 2024 Coverage (implemented, partial, not implemented)
- Save/Load Migrations
- Known Bugs
- Test Audit Status
- Missing Features (core, combat, resources)
- Homebrew Integration Points
- Code Style Notes

## Active Refactoring Efforts

### LevelUp → ClassUtils Extraction
**Status**: In progress  
**Tracking**: `LEVELUP_REFACTOR_MAP.md` at project root

Methods are being extracted from `charactersheet-levelup.js` (~4,000 lines) into `charactersheet-class-utils.js` to eliminate duplication with `charactersheet-quickbuild.js` and `charactersheet-builder.js`.

**Categories being extracted**:
1. Feature data extraction (`findFeatureOptions`, `getClassFeatureByRef`, `getFeatureOptionsForLevel`)
2. Expertise helpers (`getExpertiseGrantsForLevel`, `findExpertiseInFeature`, `parseExpertiseEntries`)
3. Language grant helpers (`getLanguageGrantsForLevel`, `findLanguageGrantsInEntries`)
4. Level feature analysis (`getLevelFeatures`, `levelGrantsAsi`, `levelGrantsSubclass`)
5. Combat tradition helpers — TGTT (`getKnownCombatTraditions`, `getMaxMethodDegree`, `getTraditionName`)
6. Spell selection helpers (partially implemented)

**Impact**: When modifying level-up or quick-build logic, check `LEVELUP_REFACTOR_MAP.md` for whether the method you need is already in ClassUtils. Use the ClassUtils version when available.

### Builder vs. LevelUp vs. QuickBuild

Three modules handle character progression with overlapping concerns:

| | Builder | LevelUp | QuickBuild |
|---|---------|---------|------------|
| **Purpose** | Create level-1 character | Single level-up | Multi-level build (1→N) |
| **Scope** | Single class | Single class, single level | N classes, levels 1-20 |
| **Apply** | Immediate per step | Immediate | Batch (collects all, applies at end) |
| **Spells** | Known/cantrip selection | Per-level spell selection | Batched spell selection |
| **Entry point** | New character button | Level up button | From Builder or header |

**Why this matters**: Duplicate logic across all three was the motivation for the ClassUtils refactor. If you fix a bug in LevelUp's feature parsing, check if QuickBuild/Builder have the same bug.

### Respec System Limitations
**Status**: Partially implemented

The respec/level history system (`charactersheet-respec.js`) stores per-level decisions but only some are editable:

| Choice Type | Editable? |
|------------|----------|
| ASI allocation | ✅ Yes |
| Feat selection | ✅ Yes |
| Subclass | ✅ Yes (with cascade warning) |
| Feature choices (Specialties, Fighting Styles) | ✅ Yes |
| Combat traditions, Weapon masteries | ✅ Yes |
| Skill proficiencies | ❌ No |
| Expertise | ❌ No |
| Spells | ❌ No ("would require extensive recalculation") |

Subclass edits trigger `state.replayHistoryMartialChoices()` for cascade recalculation.

Legacy characters (created before level history was implemented) show a badge and have edit buttons disabled. Can be rebuilt via Quick Build.

### State File Modularization
**Status**: Planned (medium-term)  
**Goal**: Split `charactersheet-state.js` (23,400 lines) into:
- `state/CharacterSheetState.js` — Core state class
- `state/AbilityScoreManager.js` — Ability score logic
- `state/ClassFeatureCalculator.js` — `getFeatureCalculations()`
- `state/SpellSlotCalculator.js` — Spell slot logic
- `state/CombatStatsCalculator.js` — AC, initiative, etc.
- `parsers/` — Individual parser files
- `state-types/ActiveStateTypes.js` — ACTIVE_STATE_TYPES

**Not started yet.** The file currently works as a monolith and all tests import the single file.

## XPHB 2024 Coverage

### Implemented
- Weapon Mastery (all 8 properties: Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex)
- Updated class features (most classes)
- New subclasses
- Updated spell slot progression
- Revised ASI
- Epic Boon picker at level 19
- Active state mutual exclusivity (Rage/Bladesong)

### Partially Implemented
- Species (formerly races) — structure supported, not all species complete
- Backgrounds — 2024 backgrounds need work
- Feats — some 2024 feats missing

### Not Implemented
- Crafting rules
- Updated tool proficiencies
- Revised conditions (exhaustion as a spectrum)
- Bastions (new subsystem)

## Save/Load Migrations

Three automatic migrations run during `loadFromJson()`:

1. **`_migrateFeatures()`**: Infers `featureType` (Class/Race/Background) for old saves that didn't store it
2. **`_migrateModifiers()`**: Re-parses feature text to extract `proficiencyBonus` flags for pre-parser saves
3. **`_migrateSpells()`**: Fixes `concentration` boolean based on spell name+source. **Critical**: Blade Ward is concentration in XPHB but NOT in PHB 2014 — migration matches BOTH name AND source to avoid incorrect conversions

When adding new state fields, always provide defaults in the load path so old saves don't break.

## Known Bugs

Active bugs are tracked in `bugs.md` at the project root. Key resolved items (for context on past issues):
- Cunning Strike / Sneak Attack UX — redesigned with toggle switches + auto-enable
- Specialty features (Observer, etc.) not applying passive skill bonuses — fixed parser
- Race ASI accumulation bug — fixed clearing logic in builder wizard steps
- Language hover errors — built dialect→parent mapping

## Test Audit Status

Tracked in `CHARACTERSHEET_TEST_AUDIT.md`:

### Resolved
- All core class subclasses have full mechanical calculations
- Weak test patterns (`getTotalLevel()` instead of `getFeatureCalculations()`) largely converted
- TGTT homebrew fully tested (737 tests)

### Remaining Work
- XPHB 2024 feature parity tests (in progress)
- Minor edge cases in multiclass combinations
- Performance optimization (memoization of `getFeatureCalculations()`)

## Missing Features (Documented in roadmap)

### Core
| Feature | Status |
|---------|--------|
| Multiclass spell slots UI | Partial (calculation exists, UI incomplete) |
| Optional class features (TCE) | Partial |
| Custom lineages (Tasha's) | Missing |
| Sidekick classes | Missing |

### Combat
| Feature | Status |
|---------|--------|
| Cover bonuses | Missing |
| Flanking (optional rule) | Missing |
| Multi-target attacks (AoE distribution) | Partial |
| Reaction tracking (per-round) | Missing |

### Resources
| Feature | Status |
|---------|--------|
| Per-encounter recovery | Missing |
| Dawn/dusk recharge timing | Partial |

## Homebrew Integration Points

TGTT (Thelemar) content is deeply integrated throughout the codebase. It's gated by settings flags but touches:
- `charactersheet-state.js` — Feature calculations, combat traditions, dream magic
- `charactersheet-combat.js` — Stamina system, combat methods
- `charactersheet-spells.js` — Spell rarity system
- `charactersheet-builder.js` — Combat tradition selections
- `charactersheet-levelup.js` — Tradition/tactic selections at level-up

When adding official D&D content, be aware that TGTT has:
- Modified subclasses for every official class
- A prestige class (Dreamwalker, 10 levels)
- An alternate combat system (17 traditions, 5 degrees, 13 battle tactics)
- Custom variant rules (exhaustion, carry weight, linguistics, jumping)

## Code Style Notes

- **Tabs** for indentation (not spaces)
- **camelCase** for methods and variables
- **PascalCase** for classes
- **underscore prefix** for private methods (`_calculateAc()`)
- **Static methods** where no instance state needed
- **Switch-case on lowercase** for class/subclass name matching
- **No decorators, no TypeScript** — plain ES modules with globalThis
