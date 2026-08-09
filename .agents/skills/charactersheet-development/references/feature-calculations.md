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

Blood Hunter (BH2022) follows this split: `getFeatureCalculations()` owns
Hemocraft scaling, save DCs, known-option counts, Brand values, and Lycan
level thresholds. Crimson Rite and Hybrid Transformation create runtime active
states with typed damage, weapon scope, defenses, AC, and natural attacks.
Their pools are synchronized by `ensureBloodHunterResources()` so Builder,
Level-Up, Quick Build, saved characters, and the active-state UI share one
current/max value.

Way of the Astral Self follows the same split. Calculations own level gates,
Martial Arts dice, activation burst/DC data, `grantedAttacks`, damage riders,
and Astral Barrage allowance. Runtime active states own whether Arms, Visage,
Body, or Awakened currently applies. Do not add an Awakened `2d10` bonus-damage
field: TCE grants Armor of the Spirit and Astral Barrage, not bonus damage.

Astral Arms uses the generic `finesseWis` pseudo-ability to resolve the best
permitted Strength, Dexterity, or Wisdom modifier. It also demonstrates
attack-scoped metadata: `reachBonus: 5` plus
`reachCondition: "onYourTurn"` is resolved by `getAttackReach()`, rather than
changing global melee reach. Its descriptor's `damage` is already the final
Martial Arts die and must be consumed unchanged by damage rollers.

Path of the Juggernaut follows the same split with a source-safe subclass
match (`TalDoreiCampaignSettingReborn`, plus the pinned `TGTT-2014` adapter
which copies that entity onto the fork's `TGTT` Barbarian). Calculations own the push distance,
shared `8 + PB + STR` save DC, Demolishing Might dice/multiplier, and level
flags. Runtime Rage supplementation owns Spirit of the Mountain and
Unstoppable defenses; `resoluteStance` owns its one-turn effects. Target
context remains transient in the canonical damage flow.

Multi-attribute `abilityDc` entries are generic feature choices. Builder,
Level-Up, and Quick Build persist the selected ability in level-history
`featureChoices`; calculations should read that durable choice and provide a
backward-compatible fallback only for legacy saves.

**Aggregation order**: named modifiers → active state bonuses → special bonuses (rage damage, sneak attack dice, critical dice). Stacking is additive unless explicitly noted otherwise.

**Hierarchical effect matching**: When checking for bonuses, the system searches hierarchically:
- `"check:str:athletics"` also matches `"check:str"` and `"check"`
- This means a state granting "advantage on Strength checks" applies to Athletics too

### Condition → State Bridge
Conditions (Frightened, Poisoned, etc.) create parallel active states with `isCondition: true`. This allows conditions to use the same bonus/effect infrastructure as toggle abilities.

Active `conditionImmunity` effects suppress matching condition-state effects
without deleting the stored condition. This is required for temporary
immunities: ending the granting state restores the still-present condition.

### Conditional Effects
Some state effects have a `conditional` field (e.g., `"while concentrating"`) that is evaluated at effect collection time. The effect only applies when the condition is met.

### Conditional Modifier Picker (gated by default)
For save/check/skill/attack modifiers that carry a `conditional` string — either text-parsed (`{type: "save:all", advantage: true, conditional: "against frightened"}`) or registry sub-typed (`{type: "save:advantage:frightened"}`) — `aggregateModifiers(type, {appliedConditionalIds})` gates them off by default and surfaces them in `result.conditionalsAvailable`. Roll handlers in `charactersheet.js` (`_rollAbilityCheck`, `_rollSavingThrow`, `_rollSkillCheck`, `_rollAttack`) probe first, show `_pPickConditionalModifiers` to the user, then re-aggregate with the opted-in IDs. Dedup key is `_buildConditionalModId(mod)` = `${baseType}|${name||note}|${conditional}` (adv/dis sub-types stripped from base). The escape hatch is `settings.skipConditionalPrompt`. `getAdvantageState(type, opts)` and `getModifierBonus(type, opts)` forward `opts` unchanged.

### Skill base-ability override (`abilitySwap:<skill>`)
Some features let a skill be computed from a *different* ability than its default (e.g. Forest Sage: "use your choice of Intelligence or Wisdom to make Arcana, Nature, Animal Handling, or Survival checks"; the TGTT "Sixth Sense" specialty). This is modeled generically with **named modifiers of type `abilitySwap:<normalizedSkill>`** carrying a `newAbility` (3-letter abv). `getSkillMod` and `getSkillBreakdown` take `MAX(default-ability mod, every swap newAbility mod)` for that skill — player-favorable, matching "your choice of" phrasing, and stacking-safe when multiple features touch the same skill. When the winning ability differs from the default, the breakdown's ability component is labelled `"<ABL> modifier (swapped from <DEFAULT>)"`.

Two ways a swap is created, both flowing through `_processFeatureModifiers` → `addNamedModifier`:
- **Structured** — a feature/specialty registers the modifier directly.
- **Prose-parsed** — `FeatureModifierParser.parseModifiers` recognizes the phrasing "use [your] choice of {A} or {B} [modifier(s)] (to make|for) {skill list} checks". It validates both abilities ∈ `Parser.ABIL_ABVS`, unwraps `{@skill …}`/HTML in the skill list, matches each skill against the canonical `Parser.SKILL_TO_ATB_ABV` key whitelist (handles multi-word keys like "animal handling" via `.replace(/\s+/g,"")`), and emits `abilitySwap:<skill>` for **each** named ability (skipping no-op swaps where `newAbility === default`). Because feats added through Level-Up / Quick-Build / Builder arrive with `entries` but no rendered `description`, `addFeat` now derives a `description` from `entries` (`Renderer.get().render({type:"entries", entries})`, guarded) **before** uses-parsing so these prose-parsed modifiers run in every flow. `_processFeatureModifiers` is idempotent (skips a re-add when an enabled modifier with the same `sourceFeatureId` + signature already exists) so deriving the description for official feats never duplicates modifiers.

### FeatureEffectRegistry
Maps feature names to effect objects. When a feature is added to the character (during build/levelup), the registry is consulted to auto-apply effects like resistances, proficiencies, and senses.

### Deferred damage maximization and damage-triggered effects

Features which modify a future damage roll use `armDamageMaximization()` rather than spending
their pool at button-click time. Damage rollers query `canApplyPendingDamageMaximization(type)`,
roll maximized dice, then call `consumePendingDamageMaximization(type)`; an ineligible roll
leaves both the pending effect and its resource untouched. Target-facing riders which trigger
from a resolved damage type use `getTriggeredDamageEffects(type)` (for example, Tempest
Cleric's optional Thunderbolt Strike push) so spell, weapon, and combat-action results share
one effect description.

### Items
Magic items can provide bonuses that stack with or override feature calculations. Item bonuses are tracked separately in state and aggregated during AC/save/skill computation.

### Reading a subclass's progression table (do NOT hardcode)

Many subclasses carry a `subclassTableGroups` block (the per-level table rendered
on the class page). Read it instead of transcribing the numbers into a `switch`:

```js
const die   = CharacterSheetClassUtils.getSubclassTableDice(subclass, level, /damage/i, "1d8");
const range = CharacterSheetClassUtils.getSubclassTableNumber(subclass, level, /range/i, 15);
const raw   = CharacterSheetClassUtils.getSubclassTableCell(subclass, level, "Chains Damage");
```

Rows are indexed by **character level** (row 0 = level 1). Column labels match by
case-insensitive substring or `RegExp`. `{@dice}` / `{@damage}` wrappers are
normalised away, and em-dash / en-dash / hyphen-only cells count as absent.

**Always pass a fallback.** `addClass` stores subclasses as lean `{name, source}`
refs, so `subclassTableGroups` is frequently unavailable at calculation time and
every reader returns `null`.

### Granting an attack from a feature (`grantedAttacks`)

Push a descriptor onto `calculations.grantedAttacks`; `getFeatureGrantedAttacks()`
filters it by `requiresState` and Combat merges it into the canonical
roll/damage path. Never build a parallel attack list.

```js
calculations.grantedAttacks.push({
    id: "feature_manifest-chains",   // stable — Combat de-dupes on id
    name: "Spectral Chains",
    isMelee: true,
    abilityMod: "finesse",           // resolved by resolveAttackAbilityKey()
    reachBonus: range - 5,           // NOT a range string, NOT a global reach effect
    damageType: "force",
    properties: ["F", "L"],
    countsAsMagical: level >= 6,     // renders a `✧ Magical` badge
    requiresState: "manifestChains", // hidden unless the state is active
});
```

`abilityMod: "finesse"` (or `"finesseWis"`) is resolved through
`resolveAttackAbilityKey()`, which picks the better of STR/DEX (or STR/DEX/WIS).
This matters for riders keyed on the *resolved* ability: Rage damage applies only
when finesse resolves to **str**, which is RAW-correct.

**Reach belongs on the attack, not on the character.** Contribute `reachBonus` per
attack; a global reach effect would extend every melee weapon the character holds.

### On-hit riders (`attackOnHitOptions`)

Riders that depend on the attack *landing* cannot be auto-applied — the sheet has
no target model and does not know whether the roll hit. Declare them and let the
generic `featureOnHitOptions` post-attack hook offer them:

```js
calculations.attackOnHitOptions.push({
    id: "chains-restrain",
    attackId: "feature_manifest-chains",
    label: "Restrain the target",
    save: {ability: "str", dc},
    recurringDamage: level,
});
```

The hook asks "did it hit?" then presents an enum picker of the eligible options.

### Extra attacks with a specific weapon (`attackActionAllowances`)

```js
calculations.attackActionAllowances.push({
    sourceFeature: "Manifest Chains",
    count: 3,
    requiresState: "manifestChains",
    label: "Unchained Fury",
});
```

`_getAttackActionAllowance()` is data-driven from this list (base is
`max(2, attackCount)`); the display-side `_getFeatureAttackActionAllowance()`
only reports an allowance that *exceeds* the base.

### Grapple size categories (`getGrappleSizeCategory()`)

`calculations.grappleSizeCategoryBonus` / `grappleSizeUnlimited` feed
`getGrappleSizeCategory()`, which returns
`{base, effective, bonus, unlimited, maxTargetSize}` and surfaces in the Overview
size-chip tooltip. Use it instead of re-deriving size math.

### State detection: an exact name beats another state's prose pattern

`detectActivatableFeature` runs **two passes** — every state's `name` is tested
against the feature before *any* state's `detectPatterns`. This is load-bearing.
Rage's pattern `you can\b.*\brage\b` is loose enough to swallow any feature whose
text merely mentions raging (e.g. "When you rage, you can choose to manifest…"),
which silently mis-resolved such features to `stateTypeId: "rage"` — wrong id,
wrong effects, wrong action type, and a spurious rage-use cost. If you add a
`detectPatterns` entry, keep it as tight as you can regardless.


## Implemented Classes (All Official + TGTT)

Every official PHB/XPHB class has full subclass calculations. All TGTT homebrew classes/subclasses have calculations. See `docs/charactersheet/10-known-limitations.md` for the full matrix.

## Performance Note

`getFeatureCalculations()` is **not memoized** — it recomputes on every call. This is a known performance concern documented in the roadmap. When calling it in tests, be aware each call traverses all classes. In a single test, call it once and assert on the result object.

## Exhaustion Contract

`getFeatureCalculations()` returns values that respect the project-wide Phase 1 doctrine:

| Field family | Reduced by exhaustion? | Why |
|---|---|---|
| `spellAttackBonus`, `ekSpellAttackBonus` (any d20 *bonus*) | ❌ Never | d20 bonuses are pure at every display/calc surface. Roll handlers apply `state._getExhaustionD20Penalty()` once at roll time. |
| `spellSaveDc`, `ekSpellSaveDc`, `*SaveDc`, `*Dc` (any *DC*) | ✅ In Thelemar rules | DC getters consume `state._getExhaustionDcPenalty()` directly and bake it in. Consumers (renderers, cast-time recompute) must NOT subtract again. |

When adding a new subclass/class case to `getFeatureCalculations()`:
- For any `calculations.*Bonus` field that represents a d20 attack bonus: compute it WITHOUT `exhaustionPenalty`. Add a one-line comment pointing at this contract.
- For any `calculations.*Dc` field: subtract `exhaustionPenalty` exactly once (and do not add the field via more than one code path).

Phase 5.6.5 cleaned up 7 legacy spell-attack-bonus sites that had baked the penalty in; the audit of every `*Dc` site confirmed they were correct as-is.

## Cross-Cutting Picker Helpers

A few class-utils helpers gate which options are visible in the optional-feature / combat-tradition / spell pickers. Always pass them the full context (class source, subclass), not just the class name.

- **`filterOptFeaturesForTgttMetamagic(features, {enableTgtt, classSource})`** — Metamagic visibility for TGTT Sorcerer. Auto-applies when `classSource === "TGTT"` regardless of the global `enableTgtt` flag, so a TGTT Thelemar Sorcerer never sees XPHB metamagic options.
- **`getAvailableTraditionsForClass(features, allowedTypes, className, classFeatures, {subclass, subclassSource})`** — Returns the tradition pool for a Fighter/Monk/etc., factoring in subclass-specific traditions and choice-restricted pools. Used by both the builder (`_renderCombatMethodsSelection`) and level-up (`_renderTraditionPicker`).
- **`getSubclassTraditionChoicePool(subclass, classSource)`** — Returns the codes a subclass is allowed to choose **from** when its grants list contains `choice: true` entries (e.g. Arcane Archer's 4 shots, Champion's 3 reaches). Returns `null` for "any tradition" subclasses (Battle Master). Pre-seeded traditions are subtracted from the requested count so the picker only asks for the *remainder*.
- **`subclassAdditionalSpellsIncludeSpell(subclass, spell, characterLevel)`** — Checks whether a subclass's `additionalSpells` block makes a given spell available at the character's level. Resolves `expanded` block filter queries (e.g. `"source=EGW"`, `"level=0|class=Cleric"`) against the actual spell, not just by exact name match. This is why Chronurgy Wizards see Gift of Alacrity and Divine Soul Sorcerers see Guidance.
- **Generic `featProgression` on optional features** — When an invocation / maneuver / fighting-style entry has a `featProgression` block, the picker queues a feat picker filtered by `category` after selection (e.g. Lessons of the First Ones → Origin Feat). The granted feat is persisted alongside the optional feature and removed if the optional feature is unselected.

## Hover Routing Discipline

The `_getFeatureHoverLink` and `getSubclassHoverLink` helpers (`charactersheet.js`) both route through `CharacterSheetClassUtils.resolveSubclassHoverSources(feature)`. This helper exists because TGTT-style `_copy` subclasses can leave `feature.classSource` pointing at the homebrew copy (`TGTT-2014`) when the canonical entry lives in PHB / EGW / etc. Always use the helper instead of reading `feature.classSource` raw — otherwise hovers produce broken hashes and the link silently 404s.
