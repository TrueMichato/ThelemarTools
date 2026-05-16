---
name: charactersheet-development
description: "Develop, debug, test, and extend the 5etools Character Sheet system (js/charactersheet/, test/jest/charactersheet/). Covers class/subclass feature calculations, toggle abilities and active states, combat mechanics, spell slot management, character builder, level-up wizard, quick build, inventory/attunement, NPC export, rest mechanics, save/load migrations, XPHB 2024 parity, the favorites system (star/unstar across tabs, orphan resolution), the Apply Buff modal for non-casters (buffpicker helpers), TGTT lore skills (flat per-skill bonus variant rule), and the unified conditional-modifier pipeline (text-parsed + registry sub-typed encodings, pre-roll picker, skipConditionalPrompt setting). Includes TGTT/Thelemar homebrew integration. Use for understanding module interactions, resolving state management issues, reviewing active refactors (LevelUp to ClassUtils extraction, state modularization), or any task mentioning character sheet, charsheet, feature calculations, toggle abilities, active states, spell slots, combat tracker, rest mechanics, favorites, buff modal, lore skills, conditional modifiers, or D&D class/subclass implementation."
---

# Character Sheet Development

## System Overview

The character sheet is **actively under development** — some subsystems are mature (class mechanics, combat), while others are in flux (LevelUp refactoring, XPHB 2024 parity, state file modularization). Understanding what's stable vs. WIP is critical before making changes.

### Key Facts

- 18 modules in `js/charactersheet/`, orchestrated by `CharacterSheetPage`
- Central state: `CharacterSheetState` (large file) in `charactersheet-state.js` — single source of truth
- 65+ test files in `test/jest/charactersheet/`
- TGTT (Thelemar) homebrew deeply integrated with dedicated tests
- Supports PHB 2014 ("classic") and XPHB 2024 ("one"), detected via source code
- Browser globals architecture — modules assign to `globalThis`, tests import then grab from `globalThis`
- `.github/instructions/charactersheet.instructions.md` auto-loads with charsheet files and provides coding standards

### Critical Data Model Fact

Ability scores are stored as **two separate fields**: `_data.abilities.str` (base score, default 10) and `_data.abilityBonuses.str` (racial/item bonuses). The total is `base + bonus`. Spell slots are keyed by level number (`_data.spellcasting.spellSlots[1].current`), not spell name.

## Before You Start

Read the reference that matches your task:

| Task | Reference |
|------|-----------|
| Understanding module roles, dependencies, data flow | [Architecture](./references/architecture.md) |
| Working with `getFeatureCalculations()`, adding class/subclass logic | [Feature Calculations](./references/feature-calculations.md) |
| Writing or fixing tests, test infrastructure, common pitfalls | [Testing Guide](./references/testing-guide.md) |
| Current WIP areas, known limitations, ongoing refactors | [Development Status](./references/development-status.md) |
| Active states, combat mechanics, NPC export, rest, spell/item data shapes | [Subsystem Details](./references/subsystem-details.md) |

Also consult the project's own workspace docs in `docs/charactersheet/` (not part of this skill) — especially `10-known-limitations.md` and `11-future-roadmap.md`.

## Procedure

### 1. Identify the Layer

Work falls into State/Model (`charactersheet-state.js`), Module/Controller (`charactersheet-{combat,spells,...}.js`), Utility (`charactersheet-class-utils.js`), Orchestrator (`charactersheet.js`), or Tests. See [Architecture](./references/architecture.md) for the full module map and data flow.

### 2. Understand the State Model

All data flows through `CharacterSheetState._data`. Key computed methods: `getAbilityMod()`, `getProficiencyBonus()`, AC calculation, and `getFeatureCalculations()` (the core method for all class/subclass mechanics). No reactive pattern — modules must call `render()` after state changes. See [Architecture](./references/architecture.md) and [Feature Calculations](./references/feature-calculations.md) for details.

### 3. Follow the Test Pattern

Tests mock browser globals via `setup.js`. Critical import pattern:

```javascript
import "../../../js/charactersheet/charactersheet-state.js";
const CharacterSheetState = globalThis.CharacterSheetState;
```

If state calls another module (e.g., `CharacterSheetClassUtils`), import it BEFORE the module under test or get `ReferenceError`. See [Testing Guide](./references/testing-guide.md) for full patterns and anti-patterns.

### 4. Run Tests

```bash
# Specific suite
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetBarbarian --no-coverage --forceExit

# Related suites after a change
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetToggleAbilities CharacterSheetCombat CharacterSheetFeatureEffects --no-coverage --forceExit

# All character sheet tests
NODE_OPTIONS='--experimental-vm-modules' npx jest test/jest/charactersheet/ --no-coverage --forceExit
```

### 5. Check for Ripple Effects

Changes to these files can affect many other modules:
- `charactersheet-state.js` → literally everything
- `charactersheet-class-utils.js` → Builder, LevelUp, QuickBuild
- `setup.js` → all test files
- `getFeatureCalculations()` → class tests, toggle tests, combat tests, feature effect tests

When modifying these, run the full test suite to catch regressions.

## Common Tasks

### Adding a subclass feature calculation

1. Find the class's section in `getFeatureCalculations()` in `charactersheet-state.js`
2. Add the subclass switch case (match by `subclassName`)
3. Use naming conventions: `has{Feature}` (bool), `{feature}Damage` (dice/number), `{feature}Dc` (save DC), `{feature}Uses` (per rest), `{feature}Bonus` (numeric)
4. Write tests in the class-specific test file using `getFeatureCalculations()` assertions
5. Read [Feature Calculations reference](./references/feature-calculations.md) for detailed patterns

### Adding a toggle ability / active state

1. Add entry to `ACTIVE_STATE_TYPES` in `charactersheet-state.js`
2. Define effects array with appropriate types (advantage, bonus, resistance, etc.)
3. Set `detectPatterns` for auto-detection from feature text
4. Handle mutual exclusivity if needed (Rage and Bladesong can't coexist)
5. Write tests in `CharacterSheetToggleAbilities.test.js`
6. Read [Toggle Abilities doc](../../docs/charactersheet/08-toggle-abilities.md) for effect types

### Fixing a combat calculation

1. Identify whether the bug is in state derivation (`charactersheet-state.js`) or UI/display (`charactersheet-combat.js`)
2. Check if active states affect the calculation (call `getBonusFromStates(type)`)
3. Check if items affect the calculation (item bonuses are stored separately as `itemBonuses.savingThrow`, `itemBonuses.spellAttack`, etc.)
4. Check if conditions/exhaustion apply penalties
5. Bonus aggregation order matters: named modifiers → active state bonuses → special bonuses (rage damage, sneak attack, crit dice)
6. Write a regression test before fixing

### Working with the NPC exporter

1. `CharacterSheetNpcExporter.convertStateToMonster(state, options)` converts character to 5etools monster JSON
2. **AC must be array of objects**: `[{ac: 15, from: ["armor"]}]`, not a flat number
3. Attack translation merges weapon magic bonuses: `bonusWeapon + bonusWeaponAttack` (to-hit), `bonusWeapon + bonusWeaponDamage` (damage)
4. CR estimation: baseline from level, ±adjustments from HP/AC defensively and attack bonus/damage offensively
5. Output must match 5etools homebrew schema format

### Working with the LevelUp/QuickBuild refactor

There is an active refactor extracting helpers from `charactersheet-levelup.js` into `charactersheet-class-utils.js`. See `LEVELUP_REFACTOR_MAP.md` at the project root for the full extraction plan. Key categories being moved:
- Feature data extraction (findFeatureOptions, getClassFeatureByRef)
- Expertise helpers
- Language grant helpers
- Level feature analysis
- Combat tradition helpers (TGTT)
- Spell selection helpers

When touching these areas: check if the method already exists in ClassUtils or is still in LevelUp, and use the ClassUtils version when available.

## Pitfalls

- **The state file is very large.** Search for landmarks: `getFeatureCalculations()` method definition, `ACTIVE_STATE_TYPES` constant, default `_data` initialization, `class Feature.*Parser` pattern.
- **Ability scores ≠ ability bonuses.** Base scores live in `_data.abilities`, racial/item bonuses in `_data.abilityBonuses`. Always use `getAbilityScore()` (returns base + bonus) and `getAbilityMod()`, never read `_data.abilities` directly for the "total".
- **Multiclass spell slot math is tricky.** Full casters count full levels, half casters half (rounded down), third casters third (rounded down), Artificer rounds up. Combined caster level determines slot table index. Warlock Pact Magic is separate.
- **TGTT/Thelemar content is everywhere.** Don't remove or break Thelemar features (combat traditions, dreamwalker, custom subclasses). Gated by settings flags.
- **Edition detection matters.** PHB and XPHB features can differ for the same class. Check `source === "XPHB"` or `edition === "one"` for 2024. Blade Ward is concentration in XPHB but not PHB 2014 — migration must match BOTH name AND source.
- **The `setup.js` mocks are minimal.** If you need Parser, Renderer, or DataUtil methods not already mocked, add them to `test/jest/charactersheet/setup.js`. Keep mocks minimal.
- **Save/load migration.** New state fields need backward-compatible defaults in `loadFromJson()`. Three migrations run automatically: `_migrateFeatures()`, `_migrateModifiers()`, `_migrateSpells()`.
- **Module init order matters.** Builder first, Spells third (needs DataUtil), Features fifth (needs class data). Each module is try/catch isolated.
- **No reactive UI.** After `state.setX()`, the module must call `render()`. Forgetting to re-render is a common bug.
- **Respec editing is partial.** ASI, feat, subclass, feature choices, combat traditions, and weapon masteries can be edited. Skills, expertise, and spells cannot.
- **Steady Aim two-phase pattern.** Grants advantage + zero speed; after the attack, only advantage is consumed (via `_consumeOnAttackStates()`), zero speed survives until turn end.

## Doc Maintenance (advisory)

When closing a bug in `bugs.md` that adds **new public state methods, new modules, new UI surfaces, or new user-facing settings**, the same change set should land doc updates in:

1. The relevant `docs/charactersheet/0X-*.md` reference doc
2. `.agents/skills/charactersheet-development/references/subsystem-details.md` (concise sub-section: function name + 2–3 line description + file/line ref)
3. `AGENTS.md` module map and/or Critical Facts (if a new module or invariant)
4. `CHARACTERSHEET_TEST_AUDIT.md` (if a new test file was added)

A bug closure narrative without these touches is incomplete — docs/skills drift fast otherwise. See [docs/charactersheet/12-contributing-guide.md](../../../docs/charactersheet/12-contributing-guide.md) for the full convention.
