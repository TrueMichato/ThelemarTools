# Feature Calculations Reference

## Contents
- Overview and How It Works
- Naming Conventions (has/Damage/Dc/Uses/Bonus/Range/Count/Die)
- Adding a New Subclass (key principles)
- Common DC Formulas
- Interaction with Other Systems (Active States, Conditions, FeatureEffectRegistry, Items)
- Implemented Classes
- Performance Note

## Overview

`getFeatureCalculations()` in `charactersheet-state.js` is the central method that computes all class-specific mechanics. It returns a flat object with boolean flags and computed values, traversing every class the character has and computing level-gated features.

## How It Works

```javascript
getFeatureCalculations() {
    const calculations = {};
    for (const cls of this._data.classes) {
        const level = cls.level;
        const className = cls.name.toLowerCase();
        const subclassName = cls.subclass?.name;
        
        switch (className) {
            case "barbarian": {
                if (level >= 1) { calculations.hasRage = true; /* ... */ }
                if (level >= 2) { calculations.hasDangerSense = true; }
                // ...subclass logic...
                break;
            }
            // ... all classes
        }
    }
    return calculations;
}
```

## Naming Conventions

These prefixes are used consistently and should be followed:

| Prefix | Type | Example |
|--------|------|---------|
| `has{Feature}` | `boolean` | `hasRage`, `hasEvasion`, `hasExtraAttack` |
| `{feature}Damage` | `string` (dice) or `number` | `rageDamage: 2`, `sneakAttack: {dice: "3d6"}` |
| `{feature}Dc` | `number` | `kiSaveDc: 14`, `maneuverSaveDc: 15` |
| `{feature}Uses` | `number` | `ragesPerDay: 3`, `actionSurgeUses: 1` |
| `{feature}Bonus` | `number` | `initiativeBonus: 5`, `fastMovementBonus: 10` |
| `{feature}Range` | `number` (feet) | `auraRange: 10`, `shadowStepRange: 60` |
| `{feature}Count` | `number` | `experimentalElixirCount: 2`, `metamagicCount: 2` |
| `{feature}Die` | `string` | `bardicInspirationDie: "d8"`, `superioritybDie: "d10"` |

## Adding a New Subclass

Follow this pattern:

```javascript
// Inside the class's switch case in getFeatureCalculations()
const subclassName = cls.subclass?.name;
if (subclassName) {
    switch (subclassName.toLowerCase()) {
        case "alchemist": {
            if (level >= 3) {
                calculations.hasExperimentalElixir = true;
                calculations.experimentalElixirCount = level >= 15 ? 3 : level >= 6 ? 2 : 1;
            }
            if (level >= 5) {
                calculations.alchemicalSavantBonus = this.getAbilityMod("int");
            }
            if (level >= 9) {
                calculations.restorativeReagentsUses = Math.max(1, this.getAbilityMod("int"));
            }
            break;
        }
    }
}
```

### Key Principles

1. **Level-gate everything**: `if (level >= N)` — features unlock at specific class levels
2. **Use ability mods for scaling**: `this.getAbilityMod("str")`, `this.getAbilityMod("wis")`, etc.
3. **Use proficiency for scaling**: `this.getProficiencyBonus()` for prof-based scaling
4. **Handle edition differences**: Check `cls.source === "XPHB"` for 2024 vs 2014 variations
5. **Lowercase subclass names**: Switch on `subclassName.toLowerCase()` for case-insensitive matching

## Common DC Formulas

| DC Type | Formula | Example |
|---------|---------|---------|
| Spell Save DC | `8 + prof + spellcasting ability mod` | Wizard: `8 + prof + INT` |
| Ki Save DC | `8 + prof + WIS` | Monk features |
| Maneuver DC | `8 + prof + STR or DEX (higher)` | Battle Master |
| Breath Weapon DC | `8 + prof + CON` | Dragonborn |
| Feature DC | `8 + prof + class ability mod` | Varies by class |

## Interaction with Other Systems

### Active States
Active states (Rage, Bladesong) provide bonuses that layer on top of feature calculations. The combat module calls `getBonusFromStates(type)` to aggregate these. Feature calculations tell you *what* the character has; active states tell you what's *currently active*.

**Aggregation order**: named modifiers → active state bonuses → special bonuses (rage damage, sneak attack dice, critical dice). Stacking is additive unless explicitly noted otherwise.

**Hierarchical effect matching**: When checking for bonuses, the system searches hierarchically:
- `"check:str:athletics"` also matches `"check:str"` and `"check"`
- This means a state granting "advantage on Strength checks" applies to Athletics too

### Condition → State Bridge
Conditions (Frightened, Poisoned, etc.) create parallel active states with `isCondition: true`. This allows conditions to use the same bonus/effect infrastructure as toggle abilities.

### Conditional Effects
Some state effects have a `conditional` field (e.g., `"while concentrating"`) that is evaluated at effect collection time. The effect only applies when the condition is met.

### Conditional Modifier Picker (gated by default)
For save/check/skill/attack modifiers that carry a `conditional` string — either text-parsed (`{type: "save:all", advantage: true, conditional: "against frightened"}`) or registry sub-typed (`{type: "save:advantage:frightened"}`) — `aggregateModifiers(type, {appliedConditionalIds})` gates them off by default and surfaces them in `result.conditionalsAvailable`. Roll handlers in `charactersheet.js` (`_rollAbilityCheck`, `_rollSavingThrow`, `_rollSkillCheck`, `_rollAttack`) probe first, show `_pPickConditionalModifiers` to the user, then re-aggregate with the opted-in IDs. Dedup key is `_buildConditionalModId(mod)` = `${baseType}|${name||note}|${conditional}` (adv/dis sub-types stripped from base). The escape hatch is `settings.skipConditionalPrompt`. `getAdvantageState(type, opts)` and `getModifierBonus(type, opts)` forward `opts` unchanged.

### FeatureEffectRegistry
Maps feature names to effect objects. When a feature is added to the character (during build/levelup), the registry is consulted to auto-apply effects like resistances, proficiencies, and senses.

### Items
Magic items can provide bonuses that stack with or override feature calculations. Item bonuses are tracked separately in state and aggregated during AC/save/skill computation.

## Implemented Classes (All Official + TGTT)

Every official PHB/XPHB class has full subclass calculations. All TGTT homebrew classes/subclasses have calculations. See `docs/charactersheet/10-known-limitations.md` for the full matrix.

## Performance Note

`getFeatureCalculations()` is **not memoized** — it recomputes on every call. This is a known performance concern documented in the roadmap. When calling it in tests, be aware each call traverses all classes. In a single test, call it once and assert on the result object.

## Cross-Cutting Picker Helpers

A few class-utils helpers gate which options are visible in the optional-feature / combat-tradition / spell pickers. Always pass them the full context (class source, subclass), not just the class name.

- **`filterOptFeaturesForTgttMetamagic(features, {enableTgtt, classSource})`** — Metamagic visibility for TGTT Sorcerer. Auto-applies when `classSource === "TGTT"` regardless of the global `enableTgtt` flag, so a TGTT Thelemar Sorcerer never sees XPHB metamagic options.
- **`getAvailableTraditionsForClass(features, allowedTypes, className, classFeatures, {subclass, subclassSource})`** — Returns the tradition pool for a Fighter/Monk/etc., factoring in subclass-specific traditions and choice-restricted pools. Used by both the builder (`_renderCombatMethodsSelection`) and level-up (`_renderTraditionPicker`).
- **`getSubclassTraditionChoicePool(subclass, classSource)`** — Returns the codes a subclass is allowed to choose **from** when its grants list contains `choice: true` entries (e.g. Arcane Archer's 4 shots, Champion's 3 reaches). Returns `null` for "any tradition" subclasses (Battle Master). Pre-seeded traditions are subtracted from the requested count so the picker only asks for the *remainder*.
- **`subclassAdditionalSpellsIncludeSpell(subclass, spell, characterLevel)`** — Checks whether a subclass's `additionalSpells` block makes a given spell available at the character's level. Resolves `expanded` block filter queries (e.g. `"source=EGW"`, `"level=0|class=Cleric"`) against the actual spell, not just by exact name match. This is why Chronurgy Wizards see Gift of Alacrity and Divine Soul Sorcerers see Guidance.
- **Generic `featProgression` on optional features** — When an invocation / maneuver / fighting-style entry has a `featProgression` block, the picker queues a feat picker filtered by `category` after selection (e.g. Lessons of the First Ones → Origin Feat). The granted feat is persisted alongside the optional feature and removed if the optional feature is unselected.

## Hover Routing Discipline

The `_getFeatureHoverLink` and `getSubclassHoverLink` helpers (`charactersheet.js`) both route through `CharacterSheetClassUtils.resolveSubclassHoverSources(feature)`. This helper exists because TGTT-style `_copy` subclasses can leave `feature.classSource` pointing at the homebrew copy (`TGTT-2014`) when the canonical entry lives in PHB / EGW / etc. Always use the helper instead of reading `feature.classSource` raw — otherwise hovers produce broken hashes and the link silently 404s.
