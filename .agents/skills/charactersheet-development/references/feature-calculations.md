# Feature Calculations Reference

## Contents
- Overview and How It Works
- Naming Conventions (has/Damage/Dc/Uses/Bonus/Range/Count/Die)
- Adding a New Subclass (key principles)
- Common DC Formulas
- Interaction with Other Systems (Active States, Conditions, FeatureEffectRegistry, Items)
- Implemented Classes
- Performance Note
- Subclass-Published Spell Slot Tables
- Rolled Casters (no spellcasting ability)
- Post-Roll d20 Intervention API
- Attack Rider Notes
- Subclass Cantrip Choice Slots
- EFA/TCE Artificer Source Separation
- RHW Reanimator R2a Projection

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

## EFA/TCE Artificer Source Separation

Artificer rules are source-qualified. Treat an `Artificer|EFA` class entry as a
different rules implementation from the legacy/TCE Artificer; never key these
differences on the class name alone.

`CharacterSheetClassUtils` is the progression authority:

- `getMaxArtificerSpellLevel(classLevel)` returns the 1/5/9/13/17 spell-level
  breakpoints. `getMaxSpellLevelForClass("Artificer", level)` and
  `getMaxSpellLevelFromProgression("artificer", level)` delegate to it.
- `getEfaArtificerPreparedSpells(classLevel)` and
  `getEfaArtificerCantrips(classLevel)` are the lean-save fallbacks for the EFA
  class tables.
- `getEfaArtificerPlansKnown(classLevel)` and
  `getEfaArtificerCreatedMagicItemsMax(classLevel)` project the Replicate Magic
  Item progression without making plan choices or creating inventory.

EFA calculation fields are:

```javascript
{
    hasEfaArtificerSpellcasting,
    hasReplicateMagicItem,
    artificerPlansKnown,
    artificerCreatedMagicItemsMax,
    hasMagicItemTinker,
    hasFlashOfGenius,
    flashOfGeniusUses,
    flashOfGeniusBonus,
    hasIngeniousMovement,
    ingeniousMovementRange,
    ingeniousMovementSourceFeatureUid,
    hasMagicItemAdept,
    hasSpellStoringItem,
    hasAdvancedArtifice,
    hasRefreshedGenius,
    hasMagicItemMaster,
    hasEfaSoulOfArtifice,
    hasMagicalGuidance,
    magicItemAttunementLimit,
}
```

EFA does **not** set the TCE-only `hasToolExpertise`, `infusionSlots`,
`infusionsKnown`, `hasRitualCasting`, `hasSoulOfArtifice`, or
`soulOfArtificeSaveBonus` fields. Its Magic Item Savant effect has five
attunement slots but `ignoreRequirements: false`. The source-aware
`FeatureEffectRegistry` entries for `Magic Item Savant|EFA` and
`Soul of Artifice|EFA` prevent same-named stored EFA features from falling back
to TCE effects.

Ritual checks must honor a stored spell's `sourceClass` (and class source when
present). An EFA Artificer spell cannot borrow ritual authorization from a
Cleric, Druid, or other multiclass leg; unattributed legacy spells retain the
existing multiclass fallback.

Cartographer is source-qualified as `Artificer|EFA` + `Cartographer|EFA`.
Ingenious Movement unlocks at Artificer level 9 with a 30-foot target and
teleport range. It is an event-only post-commit Flash of Genius follow-up, not
durable movement state and not an Adventurer's Atlas holder benefit.

The legacy Artificer subclass calculation switch remains exact-source only:
the subclass source must equal the class source, and EFA subclasses do not enter
the legacy/TCE switch merely because their names match.

### EFA Battle Smith passive contract

The EFA Battle Smith passive branch requires the exact tuple
`Artificer|EFA` + `Battle Smith|EFA` and the published class level. Public
source-qualified identities are exposed as
`CharacterSheetState.EFA_BATTLE_SMITH_SUBCLASS_UID` and
`CharacterSheetState.EFA_BATTLE_SMITH_FEATURE_UIDS`.

Its calculation output is intentionally EFA-prefixed where a legacy field would
activate runtime behavior outside the passive milestone:

```javascript
{
    hasEfaBattleSmithToolsOfTheTrade,
    efaBattleSmithToolsOfTheTradeFeatureUid,
    hasEfaBattleReady,
    efaBattleReadyFeatureUid,
    efaBattleReadyAttackAbility,
    efaBattleReadyWeaponRequirement,
    efaBattleReadyAttackMod,
    hasEfaSteelDefenderGrant,
    efaSteelDefenderFeatureUid,
    hasExtraAttack,
    attackCount,
    efaBattleSmithExtraAttackFeatureUid,
    hasEfaArcaneJolt,
    efaArcaneJoltFeatureUid,
    efaArcaneJoltDamage,
    efaArcaneJoltHealing,
    efaArcaneJoltUses,
    efaArcaneJoltRecharge,
    efaArcaneJoltOncePerTurn,
    efaArcaneJoltHealingRange,
    hasEfaImprovedDefender,
    efaImprovedDefenderFeatureUid,
    efaImprovedDefenderArcaneJoltDice,
    efaImprovedDefenderDeflectAttackDamageDice,
    efaImprovedDefenderDeflectAttackDamageBonus,
    efaImprovedDefenderDeflectAttackDamageType,
}
```

Do not replace `hasEfaSteelDefenderGrant` with legacy `hasSteelDefender`; that
field is consumed by companion-creation UI and would start the separate
companion acquisition milestone. Defender HP, AC, Rend, Repair, reactions, and
lifecycle remain owned by `CharacterSheetCompanionRules`. Likewise, EFA uses
`hasEfaBattleReady`, not legacy `hasBattleReady`, because the latter feeds the
TCE `attackAbility` effect. `Battle Ready|EFA` is an explicit empty
source-aware registry entry so a stored EFA feature cannot fall back to the TCE
effect.

The fixed Smith's Tools and Martial Weapons grants use the normal
calculation-based class-feature effect lifecycle. Weapon-proficiency comparisons
normalize `simple weapon(s)` and `martial weapon(s)` to category tokens, so the
published plural label reaches actual attack proficiency without a
Battle-Smith-only check. The additional artisan-tool choice is deferred: the
existing Builder `_renderClassToolProficiencyChoice`, Level Up
`_renderFeatChoicesUI`, Quick Build `_renderFeatSelector`, and Respec
`_applyFixedTools`/`_claimOriginProficiency` paths do not provide a shared
source-feature decision receipt. The required reusable contract is a choice
keyed by feature-owner UID and progression/timeline leg, with apply/revoke
proficiency receipts keyed by owner UID plus decision ID.

Battle Ready's Intelligence eligibility is metadata only until inventory and
Replicate Magic Item expose a canonical, source-qualified magic-weapon
provenance predicate. The future predicate must be consumed by
`getWeaponAbilityMod()` and `updateAttackFromWeapon()` and return stable item and
grant-owner identities; names, labels, rarity, `magical: true`, and custom item
metadata are not substitutes.

A proficient weapon acting as an Artificer spellcasting focus is also deferred.
The reusable focus contract must connect `getSpellcastingFocusStatus()`,
`_getSpellFocusNote()`, `_getMaterialComponentBlock()`, and `_castSpell()` to
class/feature-qualified focus candidates and commit a cast receipt containing
the selected item ID, class UID, and source-feature UID.

The EFA Battle Smith spell table continues through the exact subclass-spell
ledger rather than calculation flags. It grants XPHB Heroism/Shield at 3,
Shining Smite/Warding Bond at 5, Aura of Vitality/Conjure Barrage at 9, Aura of
Purity/Fire Shield at 13, and Banishing Smite/Mass Cure Wounds at 17. Call
`getSubclassSpellGrantOwner(cls, {sourceFeature: "Battle Smith Spells"})` and
remove with `removeSubclassSpells(owner)`; never remove by the display label
when EFA and TCE owners can coexist.

## RHW Reanimator R2a Projection

Reanimator calculations activate only for the complete mixed-source identity
`Artificer|EFA` + `Reanimator|Artificer|EFA|RHW`. A same-named subclass from
another source, an RHW Reanimator attached to TCE Artificer, or a source-less
legacy name must not activate these calculations or fixed spell grants.

`_getRhwReanimatorCalculations()` publishes the R2a availability contract:

- level 3: `hasReanimatorSpells`, `hasJoltToLife`,
  `hasReanimatorsToolsRequirement`, and
  `hasReanimatedCompanionOwnership`;
- level 5: `hasStrangeModifications` and modification count 1;
- level 9: `hasImprovedReanimation`, `hasMacabreModifications`, and
  modification count 2;
- level 15: `hasRefinedReanimation`, `hasSuperiorModifications`,
  `hasFacilitatedRevival`, `hasLifeTransfer`, and modification count 3.

Every descriptor carries the exact RHW feature UID. Reanimator's Tools reports
the live generic fixed-proficiency fallback transaction for the exact mixed
owner `Reanimator's Skill Set|Artificer|EFA|Reanimator|RHW|3|RHW`: acquisition
mode, pending/resolved status, fixed proficiency, and current selection. The
descriptor is read-only; authoritative feature ingestion and the shared
transaction own grants and choices. Reanimated Companion is ownership-only;
creation/lifecycle, modification runtime, Life Transfer resolution, action
economy, and UI belong to later milestones.

Jolt to Life uses the exact EFA Artificer level, not total character level. Its
calculation exposes uses `max(0, current INT modifier)`, exact
`Spare the Dying|XPHB` ownership, EFA spell save DC, 10-foot emanation,
Artificer-level healing, and Lightning damage `2d4`/`3d4` at EFA 11/`4d4` at
EFA 17.

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

Two Blood Hunter rules are easy to get wrong and are asserted by tests:
Stalker's Prowess speed and jump bonuses are **permanent**, not hybrid-gated
(`CS-BUG-122`), and Brand of the Voracious's advantage requires **both** hybrid
form and an active `brandedTarget` state. `brandedTarget` is a generic
`ACTIVE_STATE_TYPES` entry shared by every Brand feature across all four orders
rather than a per-feature special case.

Blood Hunter's conditional advantages (Hunter's Bane, Grim Psychometry, Hardened
Soul, Heightened Senses) live in `FeatureEffectRegistry`, not in the calculation
switch, and therefore follow the default-off conditional opt-in contract.

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

### Crafting-time modifiers

Features which alter crafting duration append machine-readable descriptors to
`calculations.craftingTimeModifiers`:

```js
{
  id: "stable-id",
  owner: {kind: "subclassFeature", name, source, uid},
  multiplier: 0.5,
  filter: {itemTypes: ["LA", "MA", "HA"]},
}
```

Consumers call
`state.getCraftingTimeCalculation({baseWorkweeks, quantity, recipe, item, category})`; they do not
branch on a class or feature name. Supported structured filters are `itemTypes`,
`recipeCategories`, and `resultCategories`. The state validates exact owner/source attribution,
rejects duplicate IDs and non-positive/non-finite multipliers, filters the descriptors against the
recipe context, sorts by stable ID, and multiplies every applicable contribution. The result
contains `baselineWorkweeks`, `effectiveWorkweeks`, `multiplier`, and `sourceBreakdown`, and is the
single value both crafting preview and outcome render.

The calculation resolves its baseline in strict order: explicit caller `baseWorkweeks`, the
existing value-derived formula when `recipe.value` is present, then the XDMG p. 221 **Magic Item
Crafting Time and Cost** rarity table for value-less `item`/`potion` recipes. That table is
Common/Uncommon/Rare/Very Rare/Legendary = 1/2/10/25/50 workweeks; its non-scroll consumable
footnote halves those values for the `potion` recipe category and one-use `A`/`AF`/`Oil`/`P` item
types. `SC` Spell Scrolls, unsupported recipe categories, and unrecognized rarities return
`{isSupported: false, reason}` so UI/tooling must surface the reason rather than hide the missing
duration.

The EFA Armorer's Tools of the Trade descriptor is source-gated to Artificer `EFA` + Armorer `EFA`
at level 3 and filters on `LA`/`MA`/`HA`. `S` shields are deliberately separate. Future features
such as an Alchemist potion discount use the same channel with
`filter: {recipeCategories: ["potion"]}`.

The EFA Battle Smith's Tools of the Trade descriptor is source-gated to Artificer `EFA` +
Battle Smith `EFA` at level 3, is owned by
`Tools of the Trade|Artificer|EFA|Battle Smith|EFA|3|EFA`, and filters on `M`/`R`.
`A`/`AF` ammunition remains on the XDMG non-scroll consumable baseline and does not receive the
weapon-crafting multiplier.

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

## Subclass-Published Spell Slot Tables

Some subclasses publish an explicit slot grid in `subclassTableGroups[].rowsSpellProgression` that intentionally deviates from generic caster math (the TGTT Rogue/Gambler's L10-12 row is 4/2 where third-caster math would give 4/3). `CharacterSheetState.getSubclassSpellSlotRow(cls)` reads that row (padding to 9 levels) and `calculateSpellSlots` overrides `baseSlots` wholesale for a **single-class, non-multiclass** caster whose subclass declares one. A static `SUBCLASS_SPELL_SLOT_TABLES` map provides a fallback keyed `"<shortName>|<source>"` in lowercase for saves whose persisted subclass lost its table group.

Consequence for the four persistence sites (builder / level-up / quick build ×2): a subclass snapshot must persist **both** `subclassTableGroups` and `cantripProgression`, or reloading the character silently reverts it to generic math.

## Rolled Casters (no spellcasting ability)

A caster whose DC/attack come from a die roll rather than an ability modifier sets `isRolledPrepared` on its `getSpellcastingClassBreakdown()` card. That card then reports:

- `ability: null`, `abilityLabel: "Rolled"`
- `saveDc: null`, `attackBonus: null` (a number here would be a lie)
- `saveDcFormula` / `attackBonusFormula` / `modifierDice` carrying the honest expression (e.g. `"8 + 4 + 1d6"`)

Every consumer branches on `isRolledPrepared` **before** reading `saveDc`/`attackBonus`, so nulls are safe. Note `getSpellcastingAbilityForClass` still returns a non-null ability for such classes — callers that need an ability for unrelated bookkeeping depend on it; the card layer is where the truth is told.

## Post-Roll d20 Intervention API

Generic hook for features that alter a d20 result *after* it is rolled (Gambler's Extra Luck, Master of Fortune):

- `getD20InterventionOffers({naturalRoll, effectiveRoll, isAdvantage, rollType})` → array of `{id, name, kind, remaining, …}`; `kind` is `"advantage"` (re-roll and take the better) or `"natOneToTwenty"`.
- `applyD20Intervention(id, ctx)` → `{applied, name, naturalRoll, effectiveRoll, secondDie, tableRoll, remaining}`. Note the field is **`secondDie`**, not `secondRoll`.

The page layer (`charactersheet.js` `_pMaybeApplyFortuneIntervention` / `_pPromptFortuneIntervention`) is wired into `_rollAbilityCheck`, `_rollSkillCheck`, `_rollSavingThrow` and, via a post-attack hook, `charactersheet-combat.js` `_rollAttack`. Escape hatch: `settings.skipFortuneInterventionPrompt`.

## Attack Rider Notes

`getAttackRiderNotes(attack)` returns generic per-attack rider strings, unioning `attack.sourceItem.attackRiders[]` with feature-derived riders. Riders surface as a badge in `_renderAttackItem` and are appended to the dice-toast title in `_rollAttack`, so a rider is never flavour text only.

## Subclass Cantrip Choice Slots

`getSubclassCantripChoiceSlots()` + the static `getSubclassSpellListClass(subclass, cls)` mint pending cantrip choices from a subclass's own `cantripProgression`, unioned in by `_ensureSubclassSpellChoices()`. Because that hook is drained by Builder, Level-Up, Quick Build and Features alike, minting there surfaces the pick in **all four flows with no new UI**. The pending choice must use `featureName: "Cantrips Known"` (a member of `PLAYER_CHOSEN_SPELL_FEATURES`), or the result is filed as feature-granted and re-prompts forever.

This closed the same gap for Eldritch Knight and Arcane Trickster: the level-up wizard's caster detection reads the **class's** `cantripProgression`, and Rogue/Fighter declare none.


Post-rebase addendum: when a subclass declares **no** `cantripProgression`
array but publishes its ladder as a "Cantrips Known" column in
`subclassTableGroups`, the slot count falls back to the shared
`CharacterSheetClassUtils.getSubclassTableNumber(subclass, level, /cantrips?\s+known/i, 0)`
reader. Prefer that reader over hardcoding any subclass scaling.

## Embedded Outcome Tables Are Not Feature Effects (CS-BUG-121)

`CharacterSheetState.stripEmbeddedOutcomeTables(html)` removes
`<table>…</table>` blocks from a rendered feature description, and is applied
by **both** `parseEffectsFromDescription()` and `detectActivatableFeature()`
before any prose-level matching.

A `<table>` inside a feature description is always a random-outcome or lookup
table — Wild Magic Surge, the TGTT Gambling Table, trinket/carousing tables.
Its rows describe what *might* happen on a particular roll; they are never the
feature's own persistent effects. The naive `replace(/<[^>]*>/g, " ")` these two
functions previously used flattened the table into the feature's prose, which
caused two distinct failures:

1. **Bogus effects.** An outcome row reading "gain a +2 bonus to initiative"
   was scraped into `{type: "bonus", target: "initiative", value: 2}` and
   stored on the active-state instance as a `customEffects` entry.
2. **Phantom toggles.** The generic `matchedBy: "analysis"` branch is guarded
   by "only consider it activatable if it actually provides some effects"
   (`parsedEffects.length > 0 || /you gain|grants? you|you (?:have|get)/`).
   Incidental "you gain …" phrasing inside a table ROW satisfied that guard, so
   an **always-on passive** (the TGTT Gambler's Folly) was promoted into an
   activatable toggle with a live Activate button — a write-only bucket that
   activated and changed nothing.

**Rule of thumb when adding a new prose parser:** normalise through
`stripEmbeddedOutcomeTables()` first. If you genuinely need the table (e.g. to
roll on it), read it from the feature's structured `entries`, not from the
flattened description text.
