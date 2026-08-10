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

### Self-Imposed Conditions on Custom Toggles (`addsConditions`)

A state can carry `addsConditions: [...]`, applied on activation and released
when the state ends (tracked per-state in `_managedConditions`, so ending a
state never strips a condition the character already had independently).

Two sources, resolved in this order by `_applyStateAddedConditions` /
`_removeStateAddedConditions`:

1. `ACTIVE_STATE_TYPES[stateTypeId].addsConditions` — hand-authored state types.
2. **Fallback:** `stateInstance.addsConditions` — for `stateTypeId: "custom"`,
   which is what every *generically detected* homebrew toggle produces. Custom
   states have no `ACTIVE_STATE_TYPES` entry, so without this fallback they
   could never impose a condition.

For custom states the array is derived from the feature text by
`CharacterSheetState.parseSelfImposedConditions(text)`: it normalizes
`{@condition X|…}` tags, matches only *self-directed* phrasings against a known
condition list, and rejects negated / immunity clauses ("you are immune to
being blinded", "you can't be blinded"). The toggle detector emits it as
`addsConditions` on the activation info, and `charactersheet.js` forwards it
into `addActiveState`.

**Prefer this over authoring a bespoke `ACTIVE_STATE_TYPES` entry** when a
homebrew feature's only extra mechanic is a condition it imposes on its owner
(e.g. Time Domain's Eyes of the Future Past → Blinded).

`_applyStateAddedConditions` is idempotent, and `addActiveState` calls it on
**both** the create path and the reactivation path — the reactivation call was
missing until CS-BUG-116, which made every activation after the first inert.

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

### Level-Dependent Effects (`effectsBuilder`)

A state type may declare `effectsBuilder: "<methodName>"`. `activateState()`
calls `this[methodName]()` whenever the caller passed no explicit
`options.customEffects`, so every activation path gets level-correct effects
without a bespoke `activateState(id, {customEffects: …})` call site. This
generalises the older `getLaunchMomentumEffects()` pattern; new features should
prefer it. Keep the literal `effects` array as a sane fallback. First customer:
`dancing` (Belly Dancer) → `getDancingEffects()`.

### Prerequisite States (`requiresStates`) and End Saves (`endSave`)

`requiresStates: ["dancing"]` hides a toggle from `getActivatableFeatures()`
until the prerequisite runs, and `deactivateState` drops dependents when it
ends — no bespoke "while Dancing" visibility logic.

`endSave: {ability, dc, onFailure: {exhaustion: 1}, label}` declares a save made
when the state ends. `getStateEndSave(id)` reads it,
`resolveStateEndSave(id, {total})` applies consequences, and
`charactersheet.js` `_pResolveStateEndSave` rolls it from the "End" button —
*after* deactivation, so the state's own bonuses don't inflate the roll.

### Contested Activation (`activationInfo.contestedCheck`)

A detected activatable feature may carry
`{skill, skillLabel, ability, opposedBy}`. `_activateFeatureState` rolls the
character's side via `_rollSkillCheck(skill, label, null, ability)` **before**
any resource deduction, then asks whether it beat the opposed roll. Losing or
cancelling costs nothing. The sheet does not model the opponent, so it rolls
honestly and asks rather than inventing the enemy's result. First customer:
Tantalizing Shivers (CHA (Performance) vs WIS (Insight)).

### Rolled Save DCs (`activationInfo.rolledSaveDc`)

`{skill, skillLabel, ability, saveAbility, range}` — for features whose save DC
is a **check result** rather than `8 + prof + mod` (*"a Wisdom saving throw, DC
equal to your Performance check result"*). Derived from prose by
`CharacterSheetState._buildRolledSaveDcInfo(text)` (no name switch) and attached
in `getActivatableFeatures()`, not `detectActivatableFeature` (many return
points). `_pResolveRolledSaveDc` rolls **before** any resource deduction, so
cancelling costs nothing, then reports the DC. Requires BOTH a check-result DC
and a named saving throw, or it returns `null` — otherwise every static-DC
feature would prompt for a roll. First customer: Jester's Privilege (TGTT Bard /
College of Jesters, L14).

### `grantsActionBenefit`

`{type: "grantsActionBenefit", action: "disengage", source}` on an active state
grants a named action's benefit for free; read via
`hasActionBenefitFromStates(action)`. First customer: Fluid Step.

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
- **State licence**: an active state carrying `{type: "sneakAttackWithoutAdvantage", meleeOnly?}` waives the trigger entirely. Read via `canSneakAttackWithoutAdvantage({isMelee})`; consumed by the auto-enable path, `_isSneakAttackTriggerSatisfied` and the toggle's condition pills. First customer: Belly Dancer's Dance of the Country (melee only)

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
**Tests**: `CharacterSheetNpcExporter.test.js` + `.matrix.test.js` + `.realsaves.test.js` (contract tests against a corpus of 24 full saves in `npc-exports/`; auto-skips when those untracked fixtures are absent)

### Key Method: `convertStateToMonster(state, options)`

**Output format**: 5etools homebrew monster JSON. Key structural requirements:
- **AC**: `[{ac: 15, from: ["Chain Mail" | "Unarmored Defense (Monk)" | "natural armor", ...]}]` — from `getAcBreakdown` / equipped armor, not hard-coded `"armor"`
- **HP**: `{average: maxHp, formula}` — average is max HP; formula uses primary class hit die + CON
- **Size**: `["M"]` — array
- **Spellcasting**: class slots and/or pact magic + separate innate block (`will` / `daily`)
- **Multiattack**: synthesized when Extra Attack / attack count ≥ 2; Extra Attack trait suppressed
- **pbNote**: character proficiency (CR is advisory only)
- **save / skill / initiative**: always **effective** values (`getSaveBreakdown().total`,
  `getSkillMod`, `getInitiativeBreakdown().total`), never canonical. A save prints when
  proficient **or** when it differs from the plain ability modifier; a skill prints when
  proficient **or** bonused. Homebrew skills are keyed `"endurance|TGTT"` (hoverable via
  `Renderer.monster.getSkillsString`, knowingly outside the bestiary schema). `initiative`
  appears only when it beats the bare DEX modifier.

Sanitize options with `getSanitizedExportOptions` (defense mode, unarmed policy, feature mode/picker, CR mode, legendary, name suffix, CR breakdown, **level signal**). `includeLevelSignal` defaults **false** — the out-of-fiction "Level Signal" trait is opt-in (forced on by `includeCrBreakdown`, which has nowhere else to put its note). **`includeCustomModifiers` defaults true** (smart leftover **Additional Effects**; bookkeeping filtered). List picker rows via `listExportableFeatures(state)` (features **and** feats).

### Runnability (v10)
The block is written to be *run*, not read: numbers instead of formulas, hovers wherever
a term exists, prose only where it adds something.
- `_resolveAbilityFormulas` annotates ability modifiers, proficiency bonus and their
  compounds with the resolved value. Compounds are stashed behind a `\uE000` placeholder
  before the bare rules run so an operand is never annotated twice. Never use a control
  character (`\u0001`) for a stash — ESLint's `no-control-regex` rejects it.
- `_enrichHoverTags` / `_tagCapabilityTerms` tag XPHB actions, `Opportunity Attack`,
  `Unarmed Strike`, `Difficult Terrain` (case-free, sentence casing kept as display
  text), `{@feat}` on feat trait names and `{@optfeature}` on maneuvers. **Must stay last
  in the chain** — any pass matching entries by plain-text name breaks once names are
  tagged. Each written tag is masked immediately or a shorter vocabulary entry nests
  inside it (`{@action {@action Opportunity Attack|XPHB}|XPHB|…}`).
- `_dropSupersededQuantityClaims` keeps the improved value when a base rule and a
  subclass rule state the same quantity; runs **after** `_consolidateShapeshiftEntries`.
- `_collapseParallelOptionLists` detects a menu by shape (3+ `{@b Label.}` blocks with a
  shared opening/ending and one short varying middle) and folds it into one sentence.
- `_condenseRosterClause` caps a hoverable roster clause at two sentences plus any
  sentence carrying a save, DC, condition or damage.
- `_resolveConditionalFeatureReferences` answers "If it has its X feature…" against
  `state.getFeatures()` instead of leaving the DM to check.
- `_dropFlavourLeadSentences` drops a lead only if it has no number, no tag, no
  mechanical or duration vocabulary, **and** nothing after it reuses a noun it
  introduced, **and** the remainder does not open with "To do so". That dependency test
  is the whole safety margin — without it the pass eats real mechanics.
- `_orderTraitsForReading` sorts traits into standing passives → resource pools →
  triggered → rosters, stably.
- A new generic resolver can silently shadow an older specialised one guarded by
  `(?!\s*\()`. After adding one, re-check the specialised rules it may have pre-empted.

### Resolved numbers and one home per feature (v11)
- **The "already annotated" guard must match the annotation shape, not "any paren".**
  `(?!\s*\()` rejected `its Charisma modifier (minimum of one)`, leaving ten real
  formulas unresolved across the corpus. A trailing minimum is now merged into one
  parenthetical (`its Charisma modifier (+5, min. 1)`), never stacked.
- **A tag is only written when it can hover.** A homebrew tag always carries a source or
  stays plain text; a sourceless `@spell` is allowed because 5etools resolves it by name.
  Spell tagging requires membership in a real spell list — matching on Title Case alone
  minted `{@spell Attack Or}` out of a mangled sentence.
- **Cross-entry passes run after the merges that create their inputs.** Order in the
  chain: `_mergeSameNameEntriesAcrossSections` → `_foldImprovedEntriesIntoBase` →
  `_dropUnownedOptionClauses` → `_applyCrossEntryQuantityUpgrades` →
  `_trimNonMechanicalSentences` → `_dropSupersededProcedures` → `_refileByStatedEconomy`
  → `_dropInertItemEntries` → `_dropDuplicateItemSpellStubs` → `_tidyEntryNames` →
  `_fixImperativeVoice`.
- **Option menus and base/upgrade pairs split across separate `entries` elements.** A
  per-line pass never sees both halves; gather across the whole entry, then rebuild.
- **Trim by identifying description, not by looking for mechanics.** "It always knows the
  direction to the branded creature" has no number, no tag and no modal, and is a rule.
  `_isPureFlavourSentence` cuts appearance, DM narration and "Describe…" only, and never a
  sentence carrying a number, a tag, or duration/permission/obligation language. Roster
  lines (`{@optfeature`, `{@combatmethod`, ≥2 semicolons) are skipped — splitting a
  semicolon-delimited list into sentences silently truncates its tail.
- **A shared resource pool is not evidence of a specific feature.** Every Sorcerer has
  Sorcery Points; only a level-18 Shadow Sorcerer has Umbral Form. Toggle-derived defenses
  require the *named feature*, not a matching `resourceName`.
- **Metamagic tuning comes from `tunedMetamagics`.** Active vs Passive vs currently-tuned
  is state, not inference. Costs come from the option's own `Cost:` line, and the affected
  spells are a canonical category label — truncating the condition produced "a spell that
  deals a type of damage from the".
- **Lift resolved numbers out of parentheses before stripping nested asides**, or the
  number is destroyed with the aside.
- **`_conjugateThirdPerson` must not re-inflect.** `[aeiou]s$` exists for "gas" → "gases";
  without a `[^aeiou]es$` guard it turned "perceives" into "perceiveses". Adverbs belong
  in `_SUBJECT_ADVERBS` (so the verb after them is found), not in the keep-set.
- **A default Unarmed Strike is filler; a monk's is not.** `_getMultiattackAction` picks
  the best weapon attack unless an unarmed strike out-damages all of them.

### Level 20, psionics and item banks (v12)
- **`modes[]` is where a psionic power's mechanics live.** A `feature._entityType ===
  "psionicPower"` carries only headers (Manifestation Time / Range / Duration) at the top
  level; without reading `modes[]` seven abilities export with zero mechanics. The
  class-rules feature's `description` is a 28KB HTML blob and must never be printed.
- **`calc.sneakAttack` is an object** — `{dice: "10d6", avgDamage: 35}`, keyed
  `sneakAttack`, *not* `sneakAttackDamage`. Other real rider keys: `smiteBaseDamage`,
  `smiteMaxDamage`, `radiantStrikesDamage`, `brutalStrikeDamage`, `rageDamage`,
  `envenomDamage`, `decayDamagePerStrain`, `timePocketDamage`.
- **A word-level guard must run on tag-reduced text.** `_isStatOnlyItemSnippet` tested
  raw text, so `{@action Magic|XPHB} action` never matched `magic action` and a real
  magic-action item was judged "stat only". Reduce `{@tag Display|SRC}` → `Display`
  first.
- **`_isRestatedSentence` returns false for any `while|when|unless`.** For *item* entries
  the "while wearing it" gate is inherent — strip it before the test, or the item's
  restatement of a resistance already on the block never drops.
- **`_getItemUseSnippet` truncates.** A rule keyed on a phrase late in the item text
  silently never fires; key on early phrases.
- **Wizard capstone spell picks are state-backed.** Spell Mastery is stored in
  `spellcasting.spellMasterySpells` and Signature Spells in
  `spellcasting.signatureSpells`; both reference canonical Wizard spellbook rows.
  NPC export may use these picks when present, but must not invent them for older
  saves. Resilient's ability can still be absent and must not be inferred.
- **A regex backreference cannot match across case.** `/\b([A-Z][a-z]{2,})\s+(\1)\b/`
  never matched `May may` — use two groups and compare lowercased.
- **CR probes must hook the real call.** Reconstructing `_estimateCr`'s arguments by hand
  reports nonsense DPR; monkey-patch `_estimateCr` and let `convertStateToMonster` supply
  them.
- **A corpus diff is the safety net for any "clever" drop rule.** Both bad drop rules in
  v12 passed lint and passed a spot check on the character they targeted, and were only
  caught by diffing all 21 exports.

### Rollable numbers, grammar and honest filing (v13)
- **A bare die is inert prose.** `_tagBareDice` runs immediately before `_enrichHoverTags`
  and wraps every `NdX` (never `d20`) in `{@damage}` or `{@dice}`. Classification reads
  what *follows* first — a unit noun (`rounds`, `Hit Points`) settles it, then a nearby
  `damage`; only then does the preceding clause vote, and a reduction verb (`reducing the
  damage`) vetoes that vote, because "roll a d12 … reducing the damage" rolls something
  that is emphatically not damage.
- **Before adding a numeric-resolution pass, read the existing `compound(…)` rules.**
  Several formula shapes are *already* summed; they were just formatted badly. A second
  summing pass for `N plus its X modifier` double-counted Tignor's Wild Shape AC to 31.
  The fix was `compound(…, {restate: true})`, which emits `18 (13 plus its Wisdom
  modifier)` instead of appending the total to the last operand — the old form asserted a
  Wisdom modifier of +18.
- **`_refileByStatedEconomy`'s action branch must exclude "take a Bonus Action".** Adding
  `takes? an? … action` without `(?!bonus\b)` moved six item entries out of Bonus Actions.
  The bonus branch needs its own `takes? a bonus action` alternative.
- **`_demoteEconomylessEntries` is gated to `{@feat …}` names and `{@item …}` bodies.**
  Class features and psionic disciplines carry authoritative economy in their metadata even
  when the prose never states it; an ungated version demoted real psionic bonus actions to
  traits. A body naming an Opportunity Attack (Sentinel) is a genuine reaction.
- **A stance body needs mechanical-sentence selection, not `_condenseRosterClause`.** The
  generic condenser keeps the *first* sentences, and stance prose always opens on flavour —
  six of thirteen corpus stances printed nothing but "heightens its senses."
  `_condenseStanceBody` strips the economy lead (bolded or plain), keeps only sentences
  carrying a tag, save, advantage, resistance, bonus, distance or extra die, drops the
  universal duration trailer, and **returns empty when nothing mechanical survives** — the
  roster above already names the stance and the name is hoverable. The duration rule is
  stated once in a `{@b Stances.}` block header.
- **Grammar repair must run late.** Subject substitution happens *after* the early prose
  compaction, so `_fixResidualGrammar` is wired both into `_tidyStatblockText` and as a
  standalone `_applyResidualGrammar` pass near the end of the chain.
  - Conjugating a coordinated verb after a finite `it <verb>s` requires refusing to fire
    when a modal or infinitive governs the span, or when the coordinator sits inside an
    **unclosed** parenthetical — otherwise every "or **take** damage" infinitive is
    corrupted.
  - The plural-subject rule (`attacks against it has` → `have`) must match through a
    closing `}`: the plural noun is often the display text of an `{@action …}` tag.
  - The doubled-word collapse must be **name-aware**. `Juen May may cast` collapsed to
    `Juen may cast`, deleting the surname and turning the sentence into a modal; the fix
    keeps the name and swaps the modal (`may` → `can`).
- **Fix a typo in this repo's own homebrew at the source.** TGTT's `methoding` was a
  botched `maneuver` → `method` rename in `homebrew/TravelersGuidetoThelemar.json`, not an
  exporter defect.

### One printing per spell, honest tags and a readable voice (v14)
- **Dedupe spells by name within a level, not by `name|source`.** The same spell arrives by
  two routes (class list, subclass/feat grant) carrying two printings, so `Fog Cloud|PHB`
  and `Fog Cloud|XPHB` both survived — 8 of 24 corpus characters printed a spell twice on
  one line. Prefer the character's edition, then the printing carrying a grant annotation.
- **`surprised` and `concentration` are `{@status}`, not `{@condition}`.** Official data
  has 260 `{@status surprised}` uses and zero condition entries for it. `_sanitizeTagKinds`
  remaps them; `_HOVERABLE_CONDITIONS` must not list them. Verify a term's *kind* in
  `data/conditionsdiseases.json` / `data/variantrules.json` before tagging it — the first
  attempt at this shipped 9 broken hovers.
- **A tag of the wrong kind must be corrected inside `_enrichHoverTags`.** Demoting one
  mid-pipeline hides the entry from passes that match on tags — an earlier version deleted
  a whole trait that way.
- **A scaling ladder is player-facing progression.** `_collapseScalingLadders` keeps the row
  that applies; the numeric resolver had been substituting the character's value into the
  ladder's own *condition* ("when its proficiency bonus **(+5) is +3**"). Runs after
  `_tagBareDice` and **entry-wide**, never per line.
- **A conditional feature gates every defence it grants.** Grouped emission
  (`{resist: [cold, lightning, thunder], note: "(Stormborn)"}`) is the correct shape; a
  test that reads `x.resist[0]` will report a false failure.
- **`_flattenOptionTables` exists because not every table is a progression.** A cost table
  (Font of Magic) or a lookup (Spellsword Technique) has every row live at once, so the
  row-selecting collapse declines it and generic tag-stripping used to destroy it — the
  sorcery-point costs were simply gone.
- **A stated die count is not a roll.** `_resolveStatedDiceAndSpeeds` turns "a number of d8s
  equal to its Wisdom modifier (5)" into `{@damage 5d8}` and "a Fly Speed equal to its
  Speed" into a distance. It takes `calculations`, so feature-derived counts (Rage Damage)
  resolve too, and it runs **before** the dice rules.
- **`_supplySubordinateClauseSubject` scans comma by comma, not by one regex.** The first
  comma is often internal to the subordinate clause, and a single match consumes the
  sentence before reaching the real boundary. Three guards, each earned from a real
  regression: a modal in the *governing prefix* (not the whole sentence) means the bare
  form is already correct; the sentence must refer to the NPC or the clause must name it;
  and a comma-separated **noun list** looks identical to a bare imperative from the left —
  "acid, cold, fire, **force**, lightning" became "it forces".
- **Four independent causes defeated coordinated-list conjugation**, each of which alone
  made the fix look inert: a clause-final adverb read as the governing verb; `it does so`
  classified as a modal when it is a pro-verb for a finite clause; imperative subjects
  supplied *last*, so the coordination lookahead inflected the earlier item in place and
  destroyed the chance to supply "it"; and the `-ly` guard swallowing `apply` in **both**
  `_conjugateThirdPerson` and the shared adverb-run regex.
- **Tag a lone action name only when a coordinated run confirms it.** Two or more action
  names in a run is the signal ("take a Bonus Action to Dash, Disengage, or Hide"); a lone
  `Hide` or `Attack` in prose is too often the ordinary English word.
- **The body uses the short name; the title carries the full one.** `_getNpcReferenceName`
  returns the given name (honorifics kept). One knock-on: the longer name had been pushing
  an item-flavour sentence past truncation, leaving a trailing `:` that a suppression rule
  caught — **an entry disappearing is not proof it was correctly suppressed.**
- **`_ensureTerminalPunctuation` runs after every trim, split and substitution.** Any of
  them can leave a line without its full stop, which reads as a truncation; it also
  collapses the `30 ft..` a resolved distance leaves at a sentence end.
- **Memoize `loadMonster` in the realsaves suite.** Corpus-wide contracts each want all 24
  characters; without a cache the suite went from ~190 s to over 15 minutes.

### Ability prose (compact + hoverable)
- Preserve `{@tags}` through strip/normalize; enrich `{@condition}` / `{@skill}`.
- `_sanitizeInboundTags` strips homebrew sources from **core** condition tags
  (`{@condition prone|TGTT}` breaks the hover) and collapses `{@quickref …|display}`.
- Some features store `description` as a **JSON string**; it is parsed and flattened
  before cleanup so raw JSON never reaches the block.
- **Third-person voice is token-based, not string substitution.** 2nd person maps to
  `§§SUBJ§§` / `§§POSS§§` / `§§REFL§§`; `_conjugateAfterSubject` (skips object position
  and `-ly` adverb runs) and `_conjugateImpliedSubjects` (guarded by modal, infinitive,
  plural-cue and `_hasBareAntecedentVerb` checks) fix agreement once; then the **name is
  emitted on first mention and `it`/`its` thereafter**, `itself` for reflexives.
  *Do not go back to name-everywhere substitution — agreement and pronoun choice become
  undecidable.*
- **Conjugation is vocabulary AND structure, deliberately.** A purely structural rewrite
  (governor test, no verb list) over-conjugated badly — "Strength**s** saving throws",
  "Long**s** Rest", "Radiant**s** damage" — because rules text is dense with verb/noun
  homographs. `_IMPLIED_SUBJECT_VERBS` bounds *what* may change; `_getClauseGovernor` +
  `_NOUN_HOMOGRAPHS` remove the false positives. Preferred failure mode: leave an unlisted
  verb in second person rather than corrupt a noun phrase.
- **`\b` does not work next to `§`.** The placeholders are non-word characters, so a
  `\b` after `§§POSS§§` never matches. Use `(?:\s|$)`. This has caused the same class of
  silent no-op guard bug more than once.
- **Global-regex lead capture is not the sentence start.** With `/g`, a `([^.!?;]*?)` lead
  group begins at `lastIndex`, so an earlier non-matching candidate can hide the clause
  governor. Compute the clause from `(offset, whole)` — that is what `_getLeadClause` is for.
- **Names match by token subset, never substring** (`_featureKeyMatches`). `"rage"` ⊂
  `"aura of courage"` under `includes`, which is how a Paladin got barbarian resistance.
- **Clause splitting is paren- and brace-aware** (`_splitIntoClauses`): `(attuned; orbiting)`
  and `{@dice …}` are single units. Splitting inside them strands unbalanced delimiters.
- **Level-progression tables arrive as rendered HTML** in `feature.description` and are
  collapsed in `_stripHtmlTags` (`_collapseLevelTables`) — list columns accumulate every
  row ≤ level, scalar columns take the latest row.
- **Tag enrichment must be a single alternation pass.** Iterating replacements over a
  sorted name list lets a short name match inside a tag emitted by a longer one
  (`{@spell Mass {@spell Cure Wounds|XPHB}|XPHB}`); one combined `replace` cannot rescan
  its own output.
- Strip level preambles in **both** ordinal (`at 5th level`) and cardinal (`at level 17`)
  form, sentence-initial and trailing; also `Rules Tip: … p166`, `Prerequisite:` (which may
  be its own **unterminated** paragraph), and use-count scaling sentences.
- **Never truncate a long feature.** `_splitFeatureDescriptionSections` splits on the
  renderer's `data-roll-name-ancestor` markers (stripping the repeated `<h3>` heading, or
  you get `{@b Switch Sides.} Switch Sides. …`), then on `<p>` boundaries; each section
  becomes its own `entries` string prefixed `{@b Label.}`. The ~900-char budget only trims
  *within* a section. The old flat 420-char cap silently ate whole sub-sections.
- `_getPlainMatchText` flattens `{@tag …}` to display text **before** classification —
  Retributive Strike's `{@action Magic|XPHB}` never matched a `\bmagic action\b` test that
  only stripped HTML.
- Permanent named-mod immunities/resists fold onto the block; **toggle** defenses (Rage,
  ACTIVE_STATE_TYPES, stances) use bestiary `{…, note, cond:true}` — on `resist`,
  `immune`, `vulnerable` **and** `conditionImmune`.
- **Stances are first-class active effects.** The stored `stanceEffects` payload is empty
  in practice, so `_parseStanceDefenseText` lifts resistances / immunities / condition
  immunities / save advantages out of the description prose and feeds them through the
  same annotation path as Rage. Keep it name-agnostic — no stance is named in code.
- `_ensureToggleAbilityIntegrity` runs after dedupe: every `while <Toggle>` annotation must
  have a defining ability, else one is synthesised from the active-state or stance
  description. A stance with parseable persistent effects is defined even when unreferenced.
- **Conditional damage riders** (`_getConditionalDamageRiders`) append Rage / Demolishing
  Might / Brutal Strike / stand-alone conditional damage to the attack lines that can gain
  them. A conditional modifier whose feature also registered an **unconditional** twin is
  skipped — that bonus is already inside the damage number (Dueling).
- **Feature-conjured weapons** (`_getFeatureWeaponActions`) become real attacks; die,
  two-handed die, damage type and finesse are parsed from prose, and the weapon's name is
  taken from the most-repeated non-generic adjective in the *whole* feature corpus (the
  granting feature says only "melee weapon"; siblings say "shadow weapon").
- **Spell provenance**: `{@spell Mage Hand|PHB} (Telekinetic)`; generic class routes
  (`Wizard Spellbook`, `Cantrips Known`, …) are not annotated. Emitted via the scoped
  static `_spellProvenanceTags`, rebuilt at the top of every `convertStateToMonster` —
  threading it through ~10 `_formatSpellTag` call sites would bury them, and conversion is
  synchronous. `_getSpellProvenanceLabel` must keep returning **plain text**, because
  `_dropRedundantSpellGrantEntries` and `_stripBlockRestatedSentences` key on it.
  `_dropRedundantSpellGrantEntries` removes a feature whose entire content was that grant —
  either because provenance names it, or because every `{@spell}` it mentions is already on
  the block (Fey Touched grants Misty Step into a wizard's spellbook, so no provenance trail
  exists) — but keeps features with real mechanics (Telekinetic's shove survives).

### v6 — attribution, compaction, spell-aware CR
- **Defence attribution**: a folded resist/immunity prints its granting feature —
  `{resist: ["poison"], note: "({@feat Poison Resilience|TGTT})"}`. `note` renders through
  `Renderer.get().render()` and **does not need `cond`** to display (`js/parser.js`,
  `_getFullImmRes_getRenderedObject`). `_getFeatureHoverTag` only tags **feats**; class /
  subclass / species features are keyed by tuples the exporter cannot rebuild, so they
  degrade to a bare name rather than a dead link. Feats reach it via
  `getFeats().map(f => ({...f, featureType: f?.featureType || "Feat"}))`.
  `_stripBlockRestatedSentences` then removes the duplicated sentence from the prose.
  *Do not extend this to spell-grant sentences* — removing "It learns the Mage Hand
  cantrip" leaves the next sentence's "it" dangling; compaction handles those instead.
- **Mode-gated defences** (`_getGatedDefenseGrants`): `While <cond>, … Resistance to <type>`
  is read from **any** feature body, emitting one conditional entry per mode so a
  shapeshifter shows both. A flat hand-entered resistance matching a gated grant is
  *converted*, not duplicated. Uses `_getPlainMatchTextCased` — the lower-casing
  `_getPlainMatchText` destroyed proper nouns in gate phrases.
- **One activation classifier.** `_classifyTextActivationSection` is gone; everything routes
  through `_getActivationSectionFromText`. The split is why "it can take a Reaction" filed
  as a trait. Do not reintroduce a second classifier.
- **Nothing is suppressed for lacking a structural home.** `advantage`/`disadvantage` are
  not in `statDerivedEffectTypes`, and a feature with labelled sub-sections is never folded
  away. Features named by a damage rider are passed as `protectedFeatureNames` and are
  **cap-exempt**, like pool owners — anything referenced elsewhere must be defined.
- **Compaction** (`_compactStatblockProse`): the prose pipeline emits **one sentence per
  entries element**, so a sentence-level rule that iterates elements silently no-ops. Flatten
  across the entry → mark dead → regroup. Kills recharge restatements, leading flavour,
  `For example…`, verbatim repeats, and build-time spellcasting bookkeeping ("…is the
  ability increased by this feat"). Also: `Rules Tip:` sub-sections dropped,
  `_stripLeadingLabelEcho` kills "{@b Forceful Blow.} Forceful Blow.",
  `_boldInlineOptionLabel` promotes `Shadowbite: …` to `{@b Shadowbite.} …`, and
  `_demoteOrphanedRider` moves a dangling shared rider below the options it qualifies.
- **Spell-aware CR**: optional `spellIndex` export option, built by the dialog from
  `DataUtil.spell.pLoadAll()` via `buildSpellThreatIndex` (converter stays pure/sync).
  Damage is gated on `damageInflict` being non-empty (else *Wish*'s incidental `1d10` reads
  as artillery); control scores off `conditionInflict`; `areaTags` weights it — every tag
  except `ST` and `MT` is a real area. Scored over the DMG's three rounds spending real
  slots. Offline, a school-weighted heuristic stands in.
- **Swappable subclass spell lists**: two or more `subSubclassSpells` tables produce a
  dedicated block marking the active mode and the long-rest switch; those spells are
  excluded from the general list.
- Feats from `getFeats()` export as real BA/reaction/trait lines; `bonusAction` named-mod stubs promoted when no feat covered them. A promoted feat attack inherits the **source weapon's** to-hit/damage bonus so the block can't contradict itself.
- Uses on ability **names** as `(6/LR)` / `(2/SR)`; Class Resources is orphan-pool only, and
  `_classifyFeatureForStatblock` takes the `resourceIndex` so a pooled ability is never
  filtered out as unimportant (that bug silently dropped Indomitable).
- Magic item named `entries` children → traits/actions (Gae Bolg style); item-granted
  spells group into one entry with proper `{@spell Name|SRC}` links; stance methods expand riders.
- Dedupe same-name level upgrades; light templates for Rage / Stone’s Endurance / Reckless
  (authored in 2nd person and pushed through the same pipeline); auto feature cap 16.
- Residual **Additional Effects** bullets are dropped when their content-word fingerprint
  is ≥80% covered by an ability already on the block (`_isEffectAlreadyDescribed`).
- Attack magic qualifier reads “The attack is magical.”

### v8 — inference, consolidation, item fidelity
- **Special Equipment is inventory-wide, not equipment-wide.** The old `item.equipped`
  gate silently dropped a Driftglobe, Pearl of Power, Javelin of Lightning and Bag of
  Holding from every export. Carried items are marked `carried`; consumables collapse to
  one `{@b Consumables:}` line. `_getMagicItemUseBlocks` **keeps** the equipped gate — a
  stowed item is worth listing but grants no ability.
- **An item trait must be its benefit, never its item-class lore.** An Ioun Stone's
  `entries` are four paragraphs of shared Ioun lore plus one benefit line; taking the
  first 240 chars printed pure flavour. `_isGenericItemClassPreamble` filters preamble (a
  paragraph that *grants* something is never preamble) and `_isStatOnlyItemSnippet`
  suppresses the trait entirely when the only benefit is an ability increase already
  folded in. This path is **browser-only** — `item.activation` is populated from live item
  data, not from the saved copy, so the Node corpus looks clean.
- **Verify before suppressing.** `_stripRestatedNumericSentences` drops "+5 bonus to
  initiative" only when a matching **enabled** `initiative` modifier exists, and an item's
  AC/save restatement only when the item is credited in `ac[].from`. Talna's Necklace
  bonus is not in the modifier registry at all — `ac[].from` was the only usable signal.
- **The character's own feature text outranks derived calculations.**
  `calculations.divineStrikeType` reports `thunder` for a 2024 Blessed Strikes cleric
  whose feature says "Necrotic or Radiant". `_getFeatureStatedDamageType` reads the text
  first. Fixing the state is out of scope.
- **Rider facts must be derived inside `_getConditionalDamageRiders`.** Attack actions are
  built ~line 236, feature blocks ~line 258; mutating a rider after the feature-block step
  is too late to reach the attack line.
- **`_mergeResilienceTraits`** folds single-clause standing defences into one attributed
  `Resilience` trait. Prefix-subsumption dedupe is required — "advantage on saves against
  spells" and "…and other magical effects" are the same benefit twice.
- **`{@b Label.}` sits mid-sentence**, not at the start ("…gains the following options:
  {@b Cloak of Shadow.} …"). `_groupSentencesIntoBenefitUnits` therefore tests *contains a
  label*, never `^`. Anchoring at `^` is a silent no-op that severs a body from its label.
- **`_dropDuplicatedStanceBodies` must run LAST** in the post-processing chain, because
  `_ensureToggleAbilityIntegrity` is what *creates* the standalone stance entry it dedupes
  against. Placed earlier it is a no-op.
- **`_getDivineFavorBlock`** renders `divineFavor[].tiers[].boons[]` (each boon carries a
  ready-to-use second-person `desc`) for tiers at or below the character's favor, labelled
  once per tier; `abilityScoreBoost` boons are skipped as already folded into the scores.
  Requires `state.setDivineFavorCatalog()`; degrades to no trait when absent. The block is
  fed into `_collectDescribedEffectTexts` so the garbled residual modifiers it replaces
  are suppressed.
- **`_consolidateShapeshiftEntries`** folds `Circle Forms` / `Improved Circle Forms` /
  `Elemental Wild Shape` into the Wild Shape ability and resolves formulas to numbers.
  `_isDecapitatedClause` drops verb-less splitter debris but **exempts labelled clauses** —
  `{@b Beast Shapes.} Known Forms 8, Max CR 1` is a deliberate stat line, not debris.
  `Wild Resurgence`, `Wild Companion` and `Primal Strike` stay separate (independently
  usable; Primal Strike also applies to weapon attacks).
- **Ambiguous skill names need a check context.** `Nature`, `Insight`, `Perception`,
  `Performance`, `Medicine`, `History`, `Survival` are common nouns; blind tagging produced
  "a {@skill Nature} spirit". Tag unambiguous skills **first**, then ambiguous ones only
  next to a check/proficiency cue, a paren, or an adjacent skill tag — that ordering is
  what lets "chosen from Insight, Persuasion, or Religion" tag all three.
- **Do not delete `out.trait` when it empties** — several base tests call
  `out.trait.some(...)` unconditionally. Only non-`trait` sections may be deleted.

### v9 — new-class coverage, resolved numbers, statblock discipline
Driven by four further saves (Dzeiy blood hunter, Reggu monk, Vern battle master, Wisp
champion), taking the real-save corpus from 7 to 11.

- **A defence scan must check whose clause it is.** `immune to the <X> condition` inside
  "the creature is immune to this curse if…" is about the *target*. Reject a match whose
  clause is introduced by a foreign subject or sits inside an `if`, or every
  "the target is immune to X" phrasing becomes a self-immunity.
- **Active-state name matching is one-directional.** Every token of the *state's* name must
  appear in the *feature's* name, never the reverse — bidirectional subset matching let a
  feature literally named `Champion` unlock the level-18 `exaltedChampion` state on a
  level-13 character. Bidirectionality stays where it belongs (resource ↔ feature).
- **`getAttacks()` rows store the bare die.** The sheet adds the ability modifier at roll
  time (`charactersheet-combat.js` renders `damage + abilityMod + damageBonus`), so a
  feature attack must be tagged `_damageIncludesAbilityMod` at *collection* time and the
  formatter must honour the flag. Sniffing the formula shape is what dropped the modifier.
- **A save-detection regex needs an explicit third-party subject.** A bare `makes?`
  alternative matches "allows it to make a Dexterity saving throw" (a save the NPC *makes*)
  as readily as "the target must make a saving throw" (one it *forces*), and stamps the
  NPC's own DC on its Evasion.
- **Item text distinguishes bearer benefits from object rules by person.** Official item
  entries address the bearer as "you"; rules about the object itself ("General Ioun Stone
  Rules", "Orbiting the Stone") are written about "a creature" in the abstract. That is far
  more robust than a heading vocabulary needing extension per item.
- **A die-annotation lookahead must match a die-value paren.** `(?!\s*\()` treats "one
  Superiority Die (no action required)" as already annotated; use `(?!\s*\(\d*d\d)`.
- **A plural word that is also a verb is disambiguated by clause position.** "The spell
  attacks Onger" takes the subject as an object; "attacks Onger makes" is a reduced
  relative whose verb needs conjugating. Treat `attacks`/`hits`/`targets`/`moves`/`saves`/
  `checks`/`rolls` as nouns when they open a clause.
- **Compaction welds bulleted lists into one string**, so any per-bullet pass must split on
  `/\s*(?=•)/` first, and bullet bodies are bare noun phrases that need normalizing to
  `It gains <clause>` before a `<subject> has/gains` detector will accept them.
- **A subsumption filter that shrinks a list can trip a `length < 2` early return** — the
  guard must distinguish "only one to begin with" from "one left after folding".
- **A home-less resource pool is named after itself** (`Focus Points (13/Short Rest)`), not
  dumped into a generic `Class Resources` row.
- **Spell tags are title-cased after the outer restore.** Running the normalizer before
  `_restoreTags` sees only `§§` placeholders.

### CR Estimation Algorithm
Staged DMG-style tables (`_CR_HP_THRESHOLDS`, `_CR_DPR_THRESHOLDS`):
1. **Defensive CR** from **effective** HP (`_getEffectiveHpForCr` counts conditional
   Rage/stance resistances, reading the already-annotated `defenses` object) + AC adjustment
2. **Offensive CR** from expected DPR — `(best attack + per-hit riders) × (multiattack +
   Bonus Action attack routine)` + **slot-scaled** caster damage via
   `_getHighestSpellSlotLevel` — and attack bonus / **spell attack bonus** / save DC.
   `_estimatePerHitRiderDamage` credits Rage, Divine Strike, a Crimson Rite, Sneak Attack
   and friends once each (conservative, never per swing);
   `_getBonusActionAttackCount` reads Flurry of Blows / two-weapon fighting / Polearm
   Master out of feature prose in either word order. Omitting both rated a level-13 monk
   at CR 6.
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
- **Class resources**: orphan pools only (covered ability names / stamina-with-methods suppressed)
- **Combat methods (TGTT)**: `getCombatMethods()` → cost groups + stance rider prose (`{@combatmethod}`)
- **Divine Favor**: a structured `Divine Favor (God)` trait built from the unlocked homebrew tiers (`_getDivineFavorBlock`); needs `setDivineFavorCatalog()`
- **Ioun stones**: every stone under Special Equipment (stowed ones marked); a stone whose only benefit is an ability increase emits no trait
- **Specialties**: important/activatable export; pure passive often omitted when already on block
- **Gemstones / armor upgrades**: state getters only (no Upgrades module load required)
- **Feats / items**: feats as action economy; item named entries + per-spell item grants
- **Residual modifiers**: smart leftover Additional Effects (default on); never dump baked-in speed/HP/skill/immunity bookkeeping

### Storage
- `charsheet-npc-export-source-config` — source meta
- `charsheet-npc-export-options` — export options (sanitized on read/write)

### Information placement: a rider rides its attack (v15)
- **Build the reference graph before removing anything.** `_buildFeatureReferenceGraph`
  finds features that *other* entries name — present in 14 of 24 corpus characters. Sneak
  Attack is a spendable currency (Cunning Strike buys effects with its dice, Assassinate
  crits with it), so printing `plus 10d6` and retiring the trait both lies and orphans
  three dependents. **Removal is available only to leaves** (`_isReferencedAnchor`).
- **Two traps the graph taught.** `Special Equipment` and `Multiattack` name every item by
  construction, so without `_STRUCTURAL_REFERRERS` every magic item became unremovable;
  and "Rage" matches inside "cou*rage*", so only multi-word names or three whitelisted
  resource words may anchor, matched with `\b…\b`, never `includes()`.
- **`calculations.sneakAttack.dice` is the rider source**; push it `named` but **not**
  `wholeFeature`, and scope it `appliesTo: "finesseOrRanged"` — Missy's Claws must not
  gain it. Item `properties` arrive as codes, sometimes suffixed (`["F|XPHB","L|XPHB"]`).
- **Item damage was never exported at all.** `item.damageRiders[]` and
  `item.conditionalBonuses[]` had no consumer; a third channel lifts on-hit damage that
  exists only in `item.itemPowers[].description` prose, guarded so an *optional* or
  daily-limited rider (Lorian's staff Lightning) and a replacement attack phrased "When
  you take the Attack action…" (Mikase's Starlight Arc) are both excluded.
- **A gate naming a different action disqualifies a rider.** Charger's `damage:charge`
  was printing `plus 5 damage after Dash + bonus action attack` on the base weapon line.
- **Residue runs before whole-feature retirement, and a surviving residue cancels it —
  but only if it still reads as a rule.** `_stripEmittedDamageClause` is clause-scoped, so
  Onger keeps "double damage to objects and structures". Divine Strike's whole sentence
  *is* the rider, leaving "…it can cause the target to."; `_isUsableRiderResidue` rejects
  that fragment so the entry is retired instead. **This is the pass that most easily
  regresses** — it reintroduced three decapitated traits on the first corpus run.
- **A fighting style is registered twice** — unconditionally (what the printed number sums)
  and again as a gated twin. `_getBakedInModifierKeys` proves the bonus is already inside
  the number. Where there is *no* unconditional twin (Dual Wielder), the gate is real and
  rides the number: `_getAcEntries` emits a second `acItem` with a `condition`.
- **Lowercasing a label breaks `_boldInlineOptionLabel`** (`(?=[A-Z"“{])` lookahead).
  `_formatProgressionCell` skips list columns and `_collapseLevelTables` emits the caption
  already bolded.

### Dialog actions
Close | Refresh | **Copy JSON** | Download JSON | Save to Homebrew. In-dialog validation panel; Save blocked on hard errors.

### Tests
`CharacterSheetNpcExporter.test.js` + `CharacterSheetNpcExporter.matrix.test.js` (class × special-system matrix) + `.realsaves.test.js` (971 contract tests against the 24-save corpus; auto-skips when absent).

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
