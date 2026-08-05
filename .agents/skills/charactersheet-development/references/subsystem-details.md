# Subsystem Details

Detailed reference for combat, active states, spells, items, NPC export, rest, and custom abilities.

## Contents
- Active States / Toggle Abilities (ACTIVE_STATE_TYPES, storage, mutual exclusivity, bonus aggregation, concentration cascade, Steady Aim)
- Combat System (attack bonus, sneak attack, action economy, weapon mastery, critical hit range scoping, turn-start effect resolver, death save roll mode)
- Spell Data Format (known/prepared, innate, spell slots)
- Inventory Item Format (items, item bonuses, weapon bonus fields)
- NPC Exporter (convertStateToMonster, CR estimation, custom source)
- Rest Mechanics (short rest, long rest, item charges)
- Combat Action Effects Pipeline (parsing, classification, effect schema, modals, subclass grants)
- Custom Abilities (data structure, effect routing, reapply on load)

## Active States / Toggle Abilities

### ACTIVE_STATE_TYPES

Core states: `rage`, `resoluteStance`, `bladesong`, `sunShield`, `wildShape`, `hybridTransformation`, `crimsonRite`, `wardingFlare`, `coronaOfLight`, `dodge`, `recklessAttack`, `steadyAim`, `patientDefense`, `stepOfTheWind`, `flurryOfBlows`, `focusedAim`, `deflectMissiles`

Astral Self states: `astralArms`, `astralVisage`, `astralBody`,
`awakenedAstralSelf`. Body uses `requiresStates`; ending a prerequisite
cascades through dependents. All four declare incapacitation/death
`endConditions`, which are enforced by the shared condition and 0-HP teardown
path.

### XPHB Light Domain

`Radiance of the Dawn` is a curated limited-use activation linked to the shared
`Channel Divinity` feature/resource; its handler spends that pool, rolls
`2d10 + Cleric level` radiant damage, and reports Constitution-save-for-half
and magical-darkness dispelling. `wardingFlare` is a one-attack
`attacksAgainst` disadvantage state backed by a Wisdom-modifier feature-use
pool. At Cleric 6 it recharges on a Short Rest and rolls `2d6 + WIS` temporary
HP. `coronaOfLight` is a one-minute, Wisdom-use aura; spell rendering calls
`getCoronaOfLightSaveDisadvantage(spell)` and only annotates saving throws for
Fire/Radiant damage spells. Radiance uses
`hasCoronaOfLightRadianceDisadvantage()` for the same target-side effect.

Each state type defines:
```javascript
{
    id: "rage",
    name: "Rage",
    icon: "💢",
    effects: [{type, target, value?, abilityMod?}],
    duration: "1 minute",        // "1 minute" = 10 rounds, "This turn" = 1 round
    endConditions: ["..."],
    resourceName: "Rage",
    resourceCost: 1,
    activationAction: "bonus",   // "bonus"|"action"|"free"|"reaction"
    trigger: {                    // Optional in-play effect control
        label: "Retaliate",
        actionType: "reaction",
        effectType: "retaliationDamage",
    },
    exclusiveWith: ["bladesong"], // Mutual exclusivity
    breaksConcentration: true,   // Rage breaks concentration on activate
    detectPatterns: ["^rage$"],  // Regex for auto-detection from feature text
    requiresClass: "barbarian",
    requiresClassLevel: 1,
}
```

### State Storage Format

`_data.activeStates[]` entries:
```javascript
{
    id: "uuid",
    stateTypeId: "rage",
    active: true,
    customEffects: null,          // Overrides stateType.effects if set
    roundsRemaining: 10,          // Decremented each round
    grantsConditions: ["frightened"], // Conditions this state grants to targets
    isCondition: false,           // true = this state IS a condition
    isSpellEffect: false,         // true = from a spell (concentration-breakable)
    concentration: false,
}
```

### Mutual Exclusivity

Hard-coded: Rage ↔ Bladesong. Enforced in `activateState()` — activating one auto-deactivates the other.

### Bonus Aggregation

`getBonusFromStates(type)` checks effects hierarchically:
- `"check:str:athletics"` → also checks `"check:str"` → also checks `"check"`
- Returns sum of all matching `value` fields + resolved `abilityMod` fields

### Concentration Breaking Cascade

When Rage (or any state with `breaksConcentration: true`) activates:
1. Calls `breakConcentration()`
2. Finds ALL states with `isSpellEffect && concentration`
3. Removes conditions those states granted (via `grantsConditions`)
4. Disables currently-concentrating custom abilities

### Subclass-Scoped State Effects

`getActiveStateEffects()` can append state-specific supplemental effects
without mutating a shared `ACTIVE_STATE_TYPES` entry. Juggernaut Rage uses this
for temporary condition, speed-reduction, and forced-movement immunities.
Condition-derived states are filtered by active `conditionImmunity` effects,
but remain persisted so their mechanics resume after the immunity ends.

### Steady Aim Two-Phase Pattern

Steady Aim has TWO effects: `advantage` on next attack + `speedZero` (speed = 0).
After one attack, `_consumeOnAttackStates()` removes ONLY the advantage effect. The `speedZero` survives until turn end.

### Blood Hunter Runtime States

`hybridTransformation` is activated through
`state.activateHybridTransformation()`, which spends its shared short-rest pool
unless level 18 mastery makes activation free. The state stores level-scaled
custom effects so save/load preserves its Predatory Strike and defenses.
Conditional resistance effects retain their condition in
`getEffectiveDefenses().conditionalResistances`, allowing the Defenses UI to
show qualified protection without promoting it to unconditional resistance.
Predatory Strike is included in the combat module's canonical weapon picker so
Crimson Rite can scope its rider to the transformed natural weapon; its
bludgeoning and slashing attack rows share that rite identity. Combat start and
round advancement both resolve Bloodlust and regeneration, 0 HP automatically
reverts the Lycan, and rests end finite transformations but preserve level 18
mastery.
`crimsonRite` is created from a selected `CR` optional feature and stores
`weaponId` on its `extraDamage` effect; combat damage filters that rider to the
chosen weapon. Both activations use dedicated controller paths because they
also pay resources or HP before the state is created.

## Combat System

### Attack Bonus Calculation
```
total = abilityMod + profBonus + weaponBonus + featureAttackBonus + stateAttackBonus
```
- `weaponBonus`: from magic item's `bonusWeapon` + `bonusWeaponAttack`
- `featureAttackBonus`: from feature calculations
- `stateAttackBonus`: from `getBonusFromStates("attack")`

### Sneak Attack Mechanics

- **Eligibility**: Weapon must have Finesse ("F") or be ranged ("T")
- **Per-turn limit**: Tracks `_lastSneakAttackRoundUsed` — one SA per round in combat
- **Cunning Strikes**: Subtract dice BEFORE rolling (e.g., 5d6 SA - 2d6 CS cost = 3d6 damage)
- **Auto-enable**: After eligible attack when conditions met (advantage or ally adjacent), SA auto-activates
- **Advantage detection**: Checks BOTH `rollD20` mode AND `hasAdvantage`/`hasDisadvantage` flags from active states

### Action Economy Tracking

`_turnActionUsage`: tracks `{action, bonus, reaction}` booleans per turn. Reset on turn advance.

### Critical Hit Range Scoping

`CharacterSheetState#getCriticalRange(kind = "weapon")` is the single shared
source of truth for "what beats a natural 20" — called from
`charactersheet-combat.js` (weapon/unarmed/flurry attacks, default `"weapon"`)
and `charactersheet-spells.js` (`"spell"`). Champion's Improved/Superior
Critical (`calc.criticalRange`) and a magic item's `critThreshold` are both
scoped to `kind !== "spell"` per RAW text ("attack rolls with weapons and
Unarmed Strikes"); homebrew active-state `critRange`/`critRange:expand`
effects are intentionally left unscoped (broadly-worded custom abilities keep
applying to any attack kind). Any future feature that widens crit range only
for a specific attack kind should add its own `kind !== "..."` guard inside
this one method rather than duplicating scoping logic per renderer.

### Turn-Start Effect Resolver

`CharacterSheetState#getTurnStartEffects()` (pure, derives a declarative
effect list from `getFeatureCalculations()`) + `#applyTurnStartEffects()`
(applies it: grants Inspiration via `setInspiration()`, heals via the
existing capped-at-max `heal()`) are the generic "start of your turn in
combat" hook, called from both `startCombat()` and `advanceRound()` in
`charactersheet-combat.js` alongside the pre-existing
`applyHybridRegenerationAtTurnStart()`. Effects returned:
`{type: "grantInspiration"|"heal", amount?, source}`. `getLastTurnStartEffects()`
exposes the most recent run's effects afterward (non-persisted) for UI
toasts. Add a new feature to this hook by (1) setting a `calc.hasXyz` flag in
`getFeatureCalculations()`, (2) branching on it inside `getTurnStartEffects()`
— no per-class turn-start UI needs to be written elsewhere. XPHB Champion's
Heroic Warrior (L10) and Survivor's Heroic Rally (L18) are both implemented
purely through this hook.

### Death Save Roll Mode & Nat-Range Override

`CharacterSheetState#getDeathSaveRollMode()` returns `{advantage, disadvantage}`
consumed by the death-save roll handler in `charactersheet-combat.js` (e.g.
XPHB Champion Survivor's Defy Death, L18, sets `advantage: true` via a
declarative `deathSave:advantage` named modifier). Separately,
`calc.hasChampionSurvivorDefyDeath` + `calc.championSurvivorDeathSaveNatRange`
(18 for Champion) widen the natural-20-only "regain 1 HP and stabilize" rule
to any roll `>= natRange` — PHB/pre-18 characters keep the strict
natural-20-only behavior via the `natRange` default of `20`. Thelemar's
generic crit-roll homebrew is suppressed on death-save rolls (`isAttack: true`)
since death saves already hardcode their own nat-1/nat-20(+widened) cases.



Class and subclass calculations can append attack descriptors to
`calculations.grantedAttacks`. `getFeatureGrantedAttacks()` marks them as
feature-owned, and the Combat attack assembly merges them with configured,
automatic, temporary, and active-state attacks. Keep the descriptor's
`attackBonus` and `damageBonus` limited to bonuses beyond its configured
`abilityMod`; the normal attack renderer and rollers add the ability modifier
and proficiency bonus. Radiant Sun Bolt uses this path so its `damage` tracks
the Monk's edition-aware Martial Arts die. Astral Arms uses the same path with
the best STR/DEX/WIS modifier (`finesseWis`), force damage, and attack-scoped
`reachBonus`/`reachCondition` metadata.
Damage rollers consume the assembled `attack.damage`; they never re-derive the
Monk die from an item.

### Variable Point Spending

Combat actions whose effect scales with committed Ki/Focus use
`_getVariablePointSpendConfig()` and `_pChooseVariablePointSpend()`. The
calculation layer supplies minimum and maximum spend; the chooser clamps that
range to the current shared point pool, returns the selected amount, and the
normal action pipeline performs the single canonical deduction. Searing Arc
Strike and Searing Sunburst then pass the selected amount to their computed
save/damage execution. Astral Arms uses the same chooser for its one-point
activation or two-point Arms-plus-Visage activation.

### Triggered Active-State Effects

An active-state type can define `trigger: {label, actionType, effectType}` and
a matching effect. `getActiveStateTrigger()` resolves `value + abilityMod`;
Combat renders a trigger button and consumes the configured action type when it
executes. Sun Shield uses this reusable path for its `5 + WIS` radiant
retaliation and reaction cost. Astral Visage resolves its 60/600-foot speech
choices through trigger metadata; Astral Body resolves `1d10 + WIS` Deflect
Energy and consumes the reaction.

Astral Self also uses the transient Attack-action tracker. Empowered Arms is an
Astral-Arms-only once-per-turn damage rider, while Astral Barrage permits a
third attack only when every attack recorded for that Attack action is an
Astral Arms attack; bonus-action, reaction, spell, weapon, and ordinary
unarmed attacks do not qualify.

### Target-Context Damage and Chained Hit Triggers

Per-hit target context belongs in `_rollDamage`, not persistent character
state. Demolishing Might demonstrates crit-compatible conditional rider dice
and a multiplier applied after the complete damage total. Thunderous Blows
demonstrates post-hit movement resolution; Hurricane Strike chains from its
resolved push and consumes the normal reaction tracker.

### Weapon Mastery Effects

All 8 XPHB properties tracked: Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex. Slots scale by class/level.

### XPHB Battle Master Maneuvers

- XPHB `MV:B` options use the generic optional-feature picker at cumulative
  counts 3/5/7/9 (levels 3/7/10/15), with one optional replacement whenever
  that progression grants new maneuvers.
- `battleMasterSuperiorityDice` is a persistent short-rest resource whose max
  scales 4/5/6 while preserving the number of spent dice during level changes.
- Every known maneuver is a generic limited activatable linked to that pool.
  Its descriptor defines action economy, save requirement, damage rider, and
  whether Relentless can replace the resource spend.
- Save maneuvers prompt between `maneuverSaveDcStr` and
  `maneuverSaveDcDex` per use. Damage maneuvers arm an attack-bound, crit-aware
  one-shot rider and enforce one maneuver per attack; Precision Attack adjusts
  the latest attack; Rally reports an ally-only temporary-HP result.
- Replacement snapshots preserve the maneuver they replaced so reload and
  level-down replay produce the correct known set. Feature-choice proficiency
  grants are source-tracked so Student of War tears down cleanly.
- XPHB Relentless is tracked once per turn and supplies a d8 instead of
  spending a superiority die. Turn advance resets the allowance.

## Spell Data Format

### Known/Prepared Spells (`_data.spellcasting.spellsKnown[]`)
```javascript
{
    name: "Fireball",
    source: "PHB",         // MUST match for migration logic
    prepared: false,       // For prepared casters
    concentration: false,  // MUST be boolean (migrated on load)
    ritual: false,         // MUST be boolean
    sourceClass: "Wizard",      // attribution — which class's list this is from
    sourceSubclass: null,       // e.g. "Gambler" for subclass casters
    sourceFeature: "Wizard Spellbook", // "Spells Known"|"Cantrips Known"|"Prepared Spells"|"Wizard Spellbook" = player-chosen
}
```

**Per-class tracking (multiclass).** Counts, save DC, and spell attack are computed
**per spellcasting class** via `getSpellcastingClassBreakdown()` — never collapsed
to one aggregate. Each spell/cantrip is attributed to a class card by matching its
`sourceClass`/`sourceSubclass` against the card's lowercased `matchKeys` (class
name, subclass name, plus the `"gambler"` alias); unmatched spells go to an
"Other / Unattributed" bucket (`getUnattributedSpellCounts()`). Player-chosen
(`isPlayerChosenSpell` — `sourceFeature ∈ {Spells Known, Cantrips Known, Prepared
Spells, Spells Prepared, Wizard Spellbook}`) vs feature-granted is split so granted
spells show as `+N granted` and don't count against the cap. Each class's DC/attack
uses its own ability via `getSpellcastingAbilityForClass` /
`getSpellSaveDcForAbility` / `getSpellAttackBonusForAbility`; cast-time routing uses
`getSpellcastingAbilityForSpell(spell)`. The Spells tab shows one card per class
(`#charsheet-spellcasting-stats`) with **no** known/prepared labels or 2014/2024
badges (mechanic kept backend-only for enforcement). See
`docs/charactersheet/07-spellcasting.md` → "Per-Class Spell Tracking (Multiclass)".

### Innate Spells
```javascript
{
    name: "Misty Step",
    source: "PHB",
    innate: true,
    uses: {current: 1, max: 1},
    usesEach: false,       // "3/day each" vs "3/day total"
    recharge: "long",      // "short"|"long"
    sourceFeature: "Fey Step",  // What grants this
}
```

### Spell Slots (`_data.spellcasting.spellSlots`)
```javascript
{
    1: {current: 4, max: 4},
    2: {current: 3, max: 3},
    // ... keyed by spell level number
}
```

**Manual pip toggling (Phase 6.2).** The Spells tab renders each slot as a `.charsheet__spell-slot-pip` element with an additional `.charsheet__spell-slot-pip--used` modifier class when consumed. Clicking a pip toggles it through `_toggleSlot`: clicking an available pip calls `state.useSpellSlot(level)` (decrement `current`); clicking the rightmost used pip calls `state.setSpellSlots(level, current + 1)` (restore one). The selector and used-class check must use the full prefixed names (`.charsheet__spell-slot-pip` and `.charsheet__spell-slot-pip--used`) — a previous shortform regression silently broke the click handler entirely.

### Divine Soul affinity spell (swappable subclass grant)

A Divine Soul Sorcerer's affinity grants ONE always-prepared spell (Good → cure wounds, etc.) that — unlike every other subclass spell — the player may swap for another **Cleric** spell. The model is generic so any future "swappable subclass grant" can reuse it:

- **Effective grant (single source of truth):** `CharacterSheetClassUtils.getEffectiveDivineSoulSpell(subclass, subclassChoice, override)` returns the per-class `classEntry.divineSoulSpellOverride` (`{name, source, level}`) if set, else the alignment default. `getDivineSoulKnownSpell` / `ensureDivineSoulKnownSpell` / `getSubclassAlwaysPreparedSpells` all read it — never re-derive per call site.
- **Tagging:** the affinity entry carries `isDivineSoulAffinity: true` (set in `_buildSubclassSpellEntry`, persisted by `addSpell`, and back-stamped onto legacy/existing entries by `populateSubclassSpells` so old saves gain the Swap button with no migration).
- **Swap:** `state.swapDivineSoulAffinitySpell(className, {name, source, level})` sets the override and does a **targeted** removal of only the current affinity entry via `_removeDivineSoulAffinityEntry` (matches the tag by name — enrichment can rewrite source PHB→XPHB — or exact `name|source` under the `"<sub> Spells"`/`"<sub> Affinity"` feature for that class). Never call `removeSubclassSpells("…")` for this — it would delete a colliding player-owned spell.
- **Cleanup:** the override + stale spell are removed when the affinity changes (`setSubclassChoice`), on switch away from Divine Soul (`setSubclass`), and on subclass removal (`removeClassLevel`).
- **UI:** `_renderSpellItem` renders an enabled **Swap** button (instead of the disabled "Locked") + a reminder for `isDivineSoulAffinity` entries; the handler `_pSwapDivineSoulAffinity` restricts the picker to `getAdditionalSpellListClasses` (→ `["Cleric"]`) at the affinity level.

### Scribable spell pool (Spell Scribing Adept)

`CharacterSheetSpells.getScribableSpells({allSpells, className, classSource, subclass, subclassChoice, maxLevel, existingIds})` builds the scribable pool via `CharacterSheetClassUtils.spellIsAvailableForClass`, so it honours expanded/granted lists (e.g. a Divine Soul Sorcerer can scribe Cleric spells). Resolve the scribing class's **full** subclass with `resolveFullSubclass` before calling so lazy `additionalSpells` are present.

## Inventory Item Format

### Items (`_data.inventory[]`)
```javascript
{
    item: {name, source, rarity, type, ...},  // Full 5etools item object
    quantity: 3,
    equipped: true,
    attuned: false,
}
```

### Item Bonuses (tracked separately)
```javascript
_data.itemBonuses: {
    savingThrow: 0,
    spellAttack: 0,
    spellSlots: {3: 1},  // Level → additional slot count
}
```

Magic weapon bonuses are THREE separate fields on the item:
- `bonusWeapon`: general bonus (applies to both attack and damage)
- `bonusWeaponAttack`: attack-only bonus
- `bonusWeaponDamage`: damage-only bonus

### Magic-item effects and powers

Catalog items use the existing `effects[]` lifecycle for passive mechanics. `addItem()` normalizes high-confidence prose-only passives into the same schema; item-owned alternative AC formulas use `{type: "acFormula", value, addDex, requireUnarmored}` and are registered/removed with `sourceFeatureId: "item:<inventoryId>"`.

Active mechanics are normalized into `itemPowers[]`:

```javascript
{
	id: "spell:fireball:phb:5",
	name: "Fireball",
	kind: "spell", // "spell" | "ability"
	actionType: "action", // "action" | "bonus" | "reaction" | "onHit" | "other"
	chargesCost: 5,
	spellName: "Fireball",
	spellSource: "PHB",
	castLevel: 5,
	description: "Cast Fireball at level 5 from Staff of Power.",
	isDestructive: false,
}
```

`getItemPowers({activeOnly})` is the shared read API for Inventory, Combat, and Play Mode. It adds current charge balance and explicit unavailable reasons for unequipped, unattuned, or undercharged items. `invokeItemPower(itemId, powerId, {confirmed})` is the sole charge transaction; destructive powers require confirmation before mutation. `attachedSpells` and named entry blocks with unambiguous activation prose are derived automatically. Ambiguous bespoke prose remains reference-only rather than receiving a misleading control.

Current generic coverage includes attached spells with charge costs, action/bonus/reaction/on-hit named powers, shared item charge pools/recharge display, alternative unarmored AC, and conditional save advantage. Staff of Power, Gae Bolg, and Robe of the Archmagi are the regression fixtures in `CharacterSheetItemPowers.test.js`.

## NPC Exporter

**Files**: `charactersheet-npc-exporter.js` (pure converter), `charactersheet-export.js` (dialog).  
**Docs**: `docs/charactersheet/18-npc-export.md`  
**Tests**: `CharacterSheetNpcExporter.test.js`

### Key Method: `convertStateToMonster(state, options)`

**Output format**: 5etools homebrew monster JSON. Key structural requirements:
- **AC**: `[{ac: 15, from: ["Chain Mail" | "Unarmored Defense (Monk)" | "natural armor", ...]}]` — from `getAcBreakdown` / equipped armor, not hard-coded `"armor"`
- **HP**: `{average: maxHp, formula}` — average is max HP; formula uses primary class hit die + CON
- **Size**: `["M"]` — array
- **Spellcasting**: class slots and/or pact magic + separate innate block (`will` / `daily`)
- **Multiattack**: synthesized when Extra Attack / attack count ≥ 2; Extra Attack trait suppressed
- **pbNote**: character proficiency (CR is advisory only)

Sanitize options with `getSanitizedExportOptions` (defense mode, unarmed policy, feature mode/picker, CR mode, legendary, name suffix, CR breakdown). List picker rows via `listExportableFeatures(state)`.

### CR Estimation Algorithm
Staged DMG-style tables (`_CR_HP_THRESHOLDS`, `_CR_DPR_THRESHOLDS`):
1. **Defensive CR** from HP + AC adjustment
2. **Offensive CR** from expected DPR (best attack × multiattack + light spell heuristic) and attack bonus / save DC
3. Blend with mild level anchor → nearest CR string (`0` … `30`, fractions included)
4. Manual override: `crMode: "manual"` + `crManual`
5. Optional `includeCrBreakdown` appends note under Level Signal

### Spellcasting fidelity
- Header uses NPC reference name (not `"The NPC"`)
- DC / attack from `getSpellSaveDc` / `getSpellAttackBonus` (and ability-specific variants)
- Innate from `getInnateSpells()` → second block
- Warlock: `getPactSlots()` → Pact Magic block when normal slots empty

### Legendary (optional, off by default)
`legendaryEnabled` → `legendaryActions` count + derived actions (weapon / move / signature) and optional `Legendary Resistance (N/Day)`.

### Special systems coverage
- **Class resources**: `getGenericPoolResources` + `getSyntheticCombatResources` + stamina → `Class Resources` trait
- **Combat methods (TGTT)**: `getCombatMethods()` → `Combat Methods` trait by stamina cost
- **Divine Favor**: innate spells via normal innate path; narrative boons as features; named mods as Custom Modifiers
- **Ioun stones**: active (orbiting) stones under Special Equipment with `orbiting` note; stowed omitted
- **Specialties**: important/activatable export; pure passive often collapses into named modifiers
- **Gemstones / armor upgrades**: state getters only (no Upgrades module load required)

### Storage
- `charsheet-npc-export-source-config` — source meta
- `charsheet-npc-export-options` — export options (sanitized on read/write)

### Dialog actions
Close | Refresh | **Copy JSON** | Download JSON | Save to Homebrew. In-dialog validation panel; Save blocked on hard errors.

### Tests
`CharacterSheetNpcExporter.test.js` + `CharacterSheetNpcExporter.matrix.test.js` (class × special-system matrix).

## Rest Mechanics

### Short Rest
- **Hit Dice**: d{classHitDie} + CON mod per die spent; minimum 1 HP healed
- **Arcane Recovery** (Wizard): Select slot levels to recover, capped by LEVEL SUM (not count). "Max 5 levels" means any combo summing ≤5. No 6th+ slots.
- **Natural Recovery** (Land Druid): Same mechanic as Arcane Recovery
- **Sorcerous Restoration** (Sorcerer 20): Auto-applies via `state.applySorcerousRestoration()`, not manual
- **Stamina pool** (TGTT): Restores on BOTH short and long rest

### Long Rest
- Full HP + half hit dice recovered (minimum 1 per die type)
- All spell slots 1-9 restored
- Class resources with `recharge: "long"` restored
- Exhaustion reduced by 1
- Temp HP reset, death saves reset to 0/0
- Concentration optionally broken

### Item Charge Restoration
Recognizes recharge types: `restLong`, `dawn`, `dusk`, `midnight` (on long rest), `restShort` (short rest only). Parses `rechargeAmount` dice notation (e.g., `"1d6 + 1"`) and rolls if present.

## Exhaustion Penalty Routing
**File**: `CharacterSheetState._getExhaustionD20Penalty` (~L9544) is the single source of truth for the per-d20 penalty. Magnitude depends on `settings.exhaustionRules`: `"thelemar"` and `"2014"` use `-1 × exhaustion`; `"2024"` uses `-2 × exhaustion`.

**Invariant — displayed bonuses are unaffected by exhaustion.** Display methods (`getSaveMod`, `getSkillModWithAbility`, `getInitiative`, party-tracker `getSaveBonus`/`getSkillBonus`) return the pure modifier with no exhaustion subtraction. The penalty is applied **once**, at the roll level, by `_rollAbilityCheck`, `_rollSavingThrow`, `_rollSkillCheck`, `_rollAttack`, and `_rollInitiative` — all of which read the canonical `state._getExhaustionD20Penalty()`. Do NOT add exhaustion to any new display getter or you will reintroduce the double-application bug.

**DC contract — DCs ARE reduced (Thelemar only).** Spell save DCs and feature save DCs *do* bake `_getExhaustionDcPenalty()` in at display/calc time. This is intentional and asymmetric with the d20-bonus rule above: the DC penalty getter returns 0 in `"2014"` and `"2024"` rules and returns the exhaustion level only in `"thelemar"`. Consumers of `getFeatureCalculations().spellSaveDc` / `.ekSpellSaveDc` / etc. must NOT subtract exhaustion again. Consumers of `.spellAttackBonus` / `.ekSpellAttackBonus` must NOT subtract exhaustion at all (it is applied once at roll time alongside any other d20 total). Phase 5.6.5 hygiene cleaned up 7 legacy spell-attack-bonus computations that violated this contract.

**Dual canonical/effective display (Phase 5.6 + Phase 6.5).** Five d20 breakdown methods now exist: `getSaveBreakdown`, `getSkillBreakdown`, `getAbilityCheckBreakdown` (added Phase 6.5 for the abilities grid), `getInitiativeBreakdown`, and `getSpellAttackBreakdown`. Each returns `{total, canonical, components}` where `components` is an array of `{type, name, value, icon, isCanonical?}` rows. The `total` field aggregates everything (it's the "effective"); `canonical` is the pure ability + proficiency sum (no exhaustion, no custom mods, no spell buffs). Phase 6.5 added exhaustion to the breakdowns as a non-canonical penalty component (`isCanonical: false`) so the effective number visibly drops while the canonical stays pure — matching the user-facing principle that "the d20 actually loses N to exhaustion." `getSpellDcBreakdown` is intentionally NOT a d20 breakdown — DCs are target numbers, and the existing DC-side exhaustion contract (above) handles them separately. The shared helper `_formatModWithEffective(canonical, effective, opts)` in `charactersheet.js` renders only the canonical value when the two match; otherwise it inlines the effective value in a smaller, color-coded `<span class="charsheet__mod-effective charsheet__mod-effective--{positive|negative}">…</span>`. Callers must use `.innerHTML` (not `.textContent`) when the helper may return HTML. The same display contract is used for `spellSaveDc` and `spellAttackBonus` via `_renderSpellcastingStats` in `charactersheet-spells.js`. **Roll handlers never consume `breakdown.total` for the d20** — they subtract `_getExhaustionD20Penalty()` themselves exactly once. Adding exhaustion to the breakdown affects display only.

**Named-modifier attribution in skill breakdowns.** `getSkillBreakdown` (both the normal and the lore-skill branch) itemizes the per-skill custom contribution **per named modifier** instead of emitting one anonymous "Custom Modifier" lump. The shared helper `_getSkillNamedModifierComponents(normalizedSkill)` walks the enabled named modifiers of type `skill:<skill>` / `skill:all`, computes each one's effective value through `_getNamedModifierEffectiveValue(mod)` (the SAME perLevel / proficiency-bonus / flat-value math `_recalculateCustomModifiers` uses, so totals can never drift), and returns one `{name, value}` row per source — e.g. a row literally named `"Magician (Primal Order)"` with value `+3`. A residual generic `"Custom Modifier"` row is emitted **only** when `getSkillCustomMod(skill) − Σ(itemized) ≠ 0`, which preserves the hard invariant `getSkillBreakdown(skill).total === getSkillMod(skill)`. `abilityMod`-based skill modifiers contribute value 0 here (they surface separately as the "Feature Bonus" line via `_getDynamicSkillFeatureBonus`) so they are never double-counted. This is the generic mechanism behind named feature bonuses always showing their source name.

**Custom modifier write contract (Phase 6.4).** `_recalculateCustomModifiers` fans a user-entered `d20:all` modifier out into the per-roll buckets that the read side consumes. `cm.abilityChecks[abl]` is set for each of the 6 abilities and is the canonical channel through which `getSkillModWithAbility` picks it up (skills *are* ability checks). The old write path **also** wrote to `cm.skills["_all"]`, which `getSkillCustomMod(skill)` reads — so a single +1 from `d20:all` ended up applied twice on every skill check (once via `abilityChecks`, once via `skills["_all"]`). Phase 6.4 dropped the `skills["_all"]` write from the `d20:all` case. The dedicated `skill:all` parser case (user-typed "+N to skill checks") still writes there and is unchanged — that is the intentional channel for skill-only modifiers. Saves and initiative were always single-channel and unaffected.

## Combat Action Effects Pipeline

The combat action effects pipeline transforms class/subclass feature text into structured combat actions displayed in the combat tab with dice rolling, effect application, and choice modals.

### Pipeline Overview

```
Feature text → _parseCombatActionEffects() → combatActionEffects object
                                                    ↓
combatActionEffects → _getFeatureSpecificContent() → modal HTML
                                                    ↓
User clicks "Use" → _useCombatAction() → _applyCombatActionEffects() → state changes
                                       → _rollCombatActionDice() → dice results
```

### Feature Classification

Features are classified into display categories via `FEATURE_CLASSIFICATION_OVERRIDES`:
- `"combat"` — Shown in combat tab with Use button (Flurry of Blows, Step of the Wind, Wall Walk, Instant Step, Whirlpool Strike, Wind Strike, Religious Training)
- `"passive"` — Applied automatically (Disciplined Survivor, Agile Acrobat)
- Toggle states remain in `ACTIVE_STATE_TYPES` (Patient Defense, Rage, Bladesong)

### Effect Schema

`_parseCombatActionEffects()` extracts from feature text:
```javascript
{
    actionType: "Action" | "Bonus Action" | "Reaction" | "Free",
    cost: { resource: "Ki Points", amount: 1 },
    damage: { die: "1d10", type: "force", scaling: "martialArtsDie" },
    bonusDamage: { die: "1d6", condition: "per subsequent hit" },
    range: "20/60 ft",
    save: { ability: "dex", dc: "combatMethodDC" },
    saveBonuses: [{ target: "save:con", value: "+proficiency" }],
    applyCondition: { name: "Invisible", duration: "until start of next turn", self: true },
    grantsAdvantage: true,
    isMultiTarget: true,
    choiceModal: true,  // Detected from "replace" wording (e.g., FoHaH replaces FoB attack)
    staminaCost: 2,
}
```

### Modal Rendering

`_getFeatureSpecificContent()` returns feature-specific HTML for the combat action modal:
- **Flurry of Blows**: Strike count (2, or 3 at L10 with Heightened Focus), healing/harm hint when `hasFlurryOfHealingAndHarm`
- **Step of the Wind**: Dash/Disengage description, jump bonus
- **Wall Walk**: Spider Climb self-cast description, duration
- **Instant Step**: Range display, invisibility condition preview
- **Wind Strike**: Ranged attack with advantage indicator, conditional bonus damage
- **Whirlpool Strike**: Multi-target creature count input, per-hit damage

`_renderModalRollSection()` adds dice roller UI when `damage` or `save` present. `_renderEffectsPreview()` shows effect badges (conditions, advantage, disadvantage).

### Choice Modals

`_showCombatActionChoiceModal()` presents branching options when `choiceModal: true`:
- **Flurry of Healing and Harm** (Mercy Monk L11): Replaces one FoB strike with Hand of Healing or Hand of Harm
- Detection: Parser finds "replace" / "in place of" wording in feature text
- Integration: FoB modal shows choice hint, clicking opens sub-modal

### Whirlpool Strike Modal

`_showWhirlpoolStrikeModal()` implements a multi-step flow:
1. User selects number of creatures (1-N)
2. For each creature, rolls attack + applies per-hit bonus damage (1d6)
3. Results displayed in aggregate

### Subclass Tradition Auto-Grants

`_subclassGrantedTraditions` maps subclass keys to combat traditions:
```javascript
_subclassGrantedTraditions: {
    "warder": ["temperedIron", "gallantHeart"],
    "tgttArcaneArcher": ["bitingZephyr"],
    "tgttMercyMonk": ["sanguineKnot"],
}
```
Applied via `combatTradition` effect type during feature calculations. Cleared and re-applied each `getFeatureCalculations()` call.

### Test Coverage

- `CharacterSheetCombatActionEffects.test.js` — 90 tests: effect pipeline, modal rendering, dice rolling, choice modals, Patient Defense preview, FoHaH choice integration
- `CharacterSheetCombatMethodsSurvey.test.js` — 81 tests: all 17 traditions parsed, stance integration, subclass grants, degree progression, DC calculation, stamina pool

## Custom Abilities

### Data Structure
```javascript
{
    id: "uuid",
    name: "Ability Name",
    icon: "⚔️",           // From 48+ emoji options
    category: "combat",    // combat|magic|roleplay|etc.
    description: "Free text",
    effects: [{type, target, value}],  // Same effect types as active states
    toggleable: false,     // If true, creates an active state
}
```

### Effect Routing
Custom ability effects go to different subsystems depending on type:
- **Numeric bonuses** (ac, damage, initiative): Registered as named modifiers
- **Advantage/Disadvantage**: Create active states
- **Resistances/Immunities**: Added directly to `_data`
- **Spells**: Registered as innate spell grants
- **Proficiencies**: Added via `addSkillProficiency()`
- **Toggleable**: Auto-create active state entries when toggled on

### Reapply on Load
`_reapplyCustomAbilityEffects()` runs during `loadFromJson()` to re-register all custom ability effects after deserialization.

## Favorites System
**Files**: state in `charactersheet-state.js` (~L22198–22365), UI in `charactersheet.js` (~L5837–6160).

Cross-tab "star this thing" backing the Actions hub favourites strip. `_data.favorites = [{id: "type:idSuffix", type, name, meta?}]`. Cap 8 by default.

API: `isFavorite(type, idSuffix)`, `addFavorite(favData, {max})`, `removeFavorite(id)`, `toggleFavorite(favData, {max})` (returns `"added"|"removed"|null`), `_resolveFavorite(fav)` (re-resolves entity, handles renames), `isFavoriteResolved(fav)`, `getOrphanedFavorites()`, `cleanupOrphanedFavorites()` (manual; orphans are NOT auto-pruned to protect against transient data-load failures).

Items use a parallel legacy favourites system that predates this one — don't duplicate.

### Overview "Favourite Spells" Card
**File**: `_renderQuickSpells` in `charactersheet.js` (~L7408).

The card on the overview titled "Favourite Spells" reads `state.getFavorites().filter(f => f.type === "spell")`, resolves each via `_resolveFavorite`, and renders a row per starred spell. Star buttons on rows in the **Spells tab** are the canonical way to add/remove entries. The renderer is also called from `_renderFavouriteStar` whenever a `type==="spell"` favourite toggles, so the overview refreshes immediately. No separate cap — it shares the 8-favourites cap.

## Overview "Resources" vs "Abilities" Cards
**Files**: `_renderResources` (~L5328) and `_renderOverviewAbilities` (~L5443) in `charactersheet.js`.

The two overview cards are intentionally non-overlapping:

- **Resources** = system / class-granted limited-use pools only — Channel Divinity, Rage, Ki, spell-resource pools, Stamina (TGTT combat-traditions pool), racial 1/day, etc. Sourced from `state.getResources()` + the stamina pool. **Custom abilities do NOT appear here.**
- **Abilities** = user-curated custom abilities only — surfaced from `state.getCustomAbilities()`. Each row has Use / Edit (✏️) / Star buttons; Edit opens `CharacterSheetCustomAbilities._showAbilityModal(id)` which exposes the icon picker. **Class resources do NOT appear here.**

CSS: `.charsheet__ability-name` and `.charsheet__resource-name` wrap with `overflow-wrap: anywhere; word-break: break-word;` so long names flow to a second line instead of being truncated by ellipsis. A `.charsheet__section-caption` element under each section title explains the split.

## Apply Buff Modal
**Files**: button in `charactersheet.js` (~L6411, Active States section, class `charsheet__apply-buff-btn`), helpers in `charactersheet-buffpicker-helpers.js`, effect application in `charactersheet-spells.js` (`_applyBuffEffects` ~L4318).

Lets non-casters apply party-cast buffs (Aid, Bless, Haste, Mage Armor) directly. Uses the **same** `_parseBuffs` registry as the casting flow, so an applied buff is mechanically identical to a cast one.

Helpers (pure, no DOM): `BUFF_CATEGORY_ORDER` (5 categories), `BUFF_CATEGORY_META`, `categoriseBuffEntry(spec)`, `buildBuffEffectChip(eff)`, `getBuffEffectChips(spec)`, `formatBuffDuration(duration, concentration)`, `isBuffSpellActive(displayName, activeStates)`.

Pipeline prefers `registryEffects` over parsed `buffs`; respects concentration cascade; disables already-active buffs with a badge.

## Lore Skills (TGTT)
**Files**: state in `charactersheet-state.js` (L6448–6492), UI in `charactersheet.js` (`_renderLoreSkillsSection` ~L2849).

TGTT variant rule: character-defined narrow knowledge skills with a flat per-skill bonus (PB added on top at roll time, no ability scaling). `_data.loreSkills = [{name, bonus}]`. API: `getLoreSkills()`, `setLoreSkillBonus(name, bonus)` (floored at 0), `removeLoreSkill(name)`. Skills with `isLoreSkill: true` are filtered out of the main Skills table (charactersheet.js L2754–2755) and rendered in their own section beneath it. Non-TGTT characters never see the section.

## Conditional Modifiers (Unified Pipeline)
**Files**: helpers + aggregator in `charactersheet-state.js` (L28518–28750), picker + roll sites in `charactersheet.js` (L8960–9610), settings checkbox in `charactersheet.html` (~L256) wired in `_initDicePicker` (~L8336).

Two equivalent encodings for conditional advantage/disadvantage/bonus modifiers:
1. **Text-parsed**: `{type: "save:all", advantage: true, conditional: "against being frightened"}`
2. **Registry sub-typed**: `{type: "save:advantage:frightened"}` — sub-type slot accepts conditions, damage types, and `magic`/`disease`/`spells`

Both flow through the same gating + picker pipeline:
- `_isConditionalSaveSubtype(subtype)` classifies sub-types (returns false for ability codes/`all`/standard skills, true for conditions/damage types/keywords)
- `getModifiersForType` synthesizes a `conditional` field on registry sub-typed entries when queried via base type (e.g. `save:dex`), so both encodings appear identical to the aggregator
- `aggregateModifiers(type, {appliedConditionalIds = new Set()})` gates conditionals off by default, surfaces them in `result.conditionalsAvailable: [{id, name, conditional, advantage?, disadvantage?, bonus?, target?}]`, dedupes via `_buildConditionalModId`
- `getAdvantageState(type, opts)` / `getModifierBonus(type, opts)` forward opts unchanged
- Roll handlers (`_rollAbilityCheck`, `_rollSavingThrow`, `_rollSkillCheck`, `_rollAttack`) probe → `_pPickConditionalModifiers` modal → re-aggregate → emit `⚡ Name (effect, condition)` lines in the result note via `_formatAppliedConditionalsNote`
- `_rollAttack` is `async` and only adds the picker's bonus delta (not the full re-aggregated bonus) to avoid double-counting registry mods already folded into `attack.attackBonus`
- Escape hatch: `settings.skipConditionalPrompt` suppresses the picker; conditionals simply don't apply (no "always apply" mode by design — that would re-introduce the Dauntless Heritage bug)
