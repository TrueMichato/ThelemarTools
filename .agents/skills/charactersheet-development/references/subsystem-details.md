# Subsystem Details

Detailed reference for combat, active states, spells, items, NPC export, rest, and custom abilities.

## Contents
- Active States / Toggle Abilities (ACTIVE_STATE_TYPES, storage, mutual exclusivity, bonus aggregation, concentration cascade, Steady Aim)
- Combat System (attack bonus, sneak attack, action economy, weapon mastery, critical hit range scoping, turn-start effect resolver, death save roll mode)
- Spell Data Format (known/prepared, innate, spell slots)
- Inventory Item Format (items, item bonuses, weapon bonus fields, item materials)
- NPC Exporter (convertStateToMonster, CR estimation, custom source)
- Rest Mechanics (short rest, long rest, item charges)
- Combat Action Effects Pipeline (parsing, classification, effect schema, modals, subclass grants)
- Custom Abilities (data structure, effect routing, reapply on load)
- Gemstone Empowerment (host-scoped effects, resources, riders, Chalice storage)

## Gemstone Empowerment

TGTT's 39 empowered gemstones are defined by `GEMSTONE_EFFECT_REGISTRY` in
`charactersheet-upgrades.js`. `CharacterSheetState.getGemstoneEffects()` is the
canonical runtime channel. It annotates each descriptor with `hostItemId`,
`gemInstanceId`, runtime state, and the exact host item, and applies TGTT,
equipped, and attunement gates. Consumers must query this channel rather than
adding new gemstone-name switches.

Gem-owned state lives in `_gemstoneData.runtime` while loose and in the same
gem object while socketed. Socketing and unsocketing move the stable
`gemInstanceId`, resources, choices, and stored spells together; host charges
and host `storedSpells` are never used for gemstone mechanics. Synthetic
resource IDs have the shape `gem:<gemInstanceId>:<key>` and
`setResourceCurrent()` routes them back to the gem.

Conditional damage dice use
`getGemstoneDamageRidersForAttack(attack, targetContext)`. It requires the exact
`attack.sourceItem.id` and feeds Combat's rider-parts pipeline, never the
standing flat-damage line. Chalice storage uses
`getGemstoneSpellStorage`/`storeGemstoneSpell`/`castGemstoneStoredSpell`/
`removeGemstoneStoredSpell`; its two-level capacity is gem-scoped and persists
across unsocket/resocket.

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

### Concentration Is A List

`_data.concentrations[]` is the store; `_data.concentrating` is legacy and migrates
on load. Entries are `{id, kind: "spell"|"power"|"ability", name, order, modeName, …}`.

- `getConcentration()` is a **back-compat shim** returning the first entry, so every
  pre-existing single-slot caller is untouched. Use `getConcentrations()`,
  `getConcentrationCount()`, `getPowerConcentrations()` / `getSpellConcentration()`
  for the real picture.
- `addConcentration(entry, {replaceId})` owns the rules: a spell or ability clears
  everything; a power clears any spell then respects `getPowerConcentrationMax()`
  (= proficiency bonus, psionic manifesters only); re-adding the same id replaces
  its own entry. Never write `_data.concentrations` directly.
- `breakConcentration(id?)` drops one entry or everything. With **no id** it also
  performs an unconditional sweep (dismiss companions, clear the legacy state) even
  when nothing was concentrated on — callers rely on that defensively.
- `_teardownConcentration()` removes the matching active manifestation for a power,
  so the "concentration ended ⇒ power stopped" invariant holds however it was dropped.

See `docs/charactersheet/17-talent-psionics.md` for the psionic side.

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

### Standing Weapon Damage Display

`CharacterSheetState.getWeaponDisplayDamageBonus(attack)` is the shared source for
the non-ability flat bonus shown in Combat, Overview, and Play Mode, and for the
standing-flat portion of `_rollDamage`. It includes the attack's authoritative
`damageBonus`, unconditional numeric feature modifiers, matching weapon-scoped
item contributions, active-state damage, eligible Rage damage, and eligible
Hybrid Transformation damage.

Generated attacks already cache their source weapon's ordinary magic and custom
flat bonuses in `attack.damageBonus`; custom attacks store the explicitly authored
value there. Consumers must not independently add the source item's ordinary
`bonusWeapon`/`bonusWeaponDamage`, or generated attacks will double-count it.
Conditional, manual/once-per-turn, critical-only, ammunition, spell-only, and dice
riders remain roll-time concerns and must not appear in the standing formula.

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
    item: {
        name, source, rarity,
        type,       // Coarse inventory category ("gear", "weapon", ...)
        typeCode,   // Authoritative 5etools code, including suffix ("SCF|XPHB")
        scfType, focus,
        ...
    },
    quantity: 3,
    equipped: true,
    attuned: false,
}
```

Catalog adds preserve both type layers: inventory grouping continues to use the coarse
`type`, while rules logic reads `typeCode` first and strips any `|source` suffix.
`CharacterSheetInventory.setItems()` injects the enhanced catalog into state;
`loadFromJson()` then repairs missing `typeCode` / `scfType` / `focus` by exact,
case-insensitive `name|source`. The migration is idempotent, skips custom items, and
never overwrites metadata already present on the save.

### Usable adventuring gear

`getUsableGear()` is the canonical read API for type-`G` items whose entries declare an
Attack/Utilize action or legacy action prose. Every activation has one explicit policy:

- `consume`: Acid, Alchemist's Fire, Holy Water, and Oil variants decrement quantity.
- `deploy-recoverable`: Ball Bearings and Caltrops remain in inventory after deployment.
- `reference-only`: ambiguous gear such as Rope requires confirmation and is never removed.

Combat renders these activations through the quick-use item surface. Derived item powers
carry a stable activation fingerprint; `getItemPowers()` suppresses a power only when its
`itemId + activationFingerprint` matches usable gear, preventing duplicate controls while
preserving unrelated powers on the same item.

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

### Item materials (TGTT)

An item may carry `material: {name, source}` — a **non-destructive reference** to one of the
72 `itemMaterial` entities. The base item is never mutated; `getItems()` runs
`projectItemMaterial()` and every downstream reader sees the projected stats.

```javascript
{
	name: "Longsword",
	dmg1: "1d8",                                   // base — never rewritten
	material: {name: "Darkmetal", source: "TGTT"},
}
// getItems() -> {dmg1: "1d10", dmg2: "1d12", penetration: 2, weight: 5.95, property: ["V","H"]}
```

- **Use `state.getItemRaw(id)`** whenever you need the *unprojected* item. Previewing a
  candidate material against an already-projected item is a bug (it double-applies).
- Material effects are **structured data** (33 `type` values), never hardcoded per name.
  Many carry an `appliesTo` gate — Darkmetal's `+1 AC` is `["shield"]` only.
- Axes are **tri-state**: `number` / `"na"` (cannot apply) / `null` (Varies).
  `magicCapacity` also accepts `"infinity"` / `"-infinity"`.
- `CharacterSheetMaterials.stepDamageDie` uses an **11-step ladder** (`1d4 … 3d10`) with
  negative steps. `CharacterSheetUpgrades.increaseDamageDie` is a *different*, narrower
  ladder capped at `1d12` — do not merge them.
- ⚠️ `_data.ac.armor` / `_data.ac.shield` are snapshots stamped at `equip()` time.
  `_onItemMaterialChanged()` must call `_refreshEquippedAcSlots()` or an equipped item's
  material change never reaches AC / Dex cap / STR penalty.
- Gated by `settings.enableMaterials` plus five sub-toggles (`materials_weightFromDensity`,
  `materials_recomputeValue`, `materials_magicCapacity`, `materials_penetration`,
  `materials_degradation`).
- **Magic Capacity** counts magical effects against the material's MC budget:
  `countMagicalEffects` → `getMagicCapacityStatus` → `rollMagicalInterference`.
  Counting reads **`getItemRaw()`**, never the projection — a material's intrinsic
  properties are what the item *is*, not enchantments placed into it. Bonus families
  (`bonusWeapon` + `bonusWeaponAttack` + `bonusWeaponDamage`) collapse to one.
  `passed = d20 >= 15 + over`; failure rolls d8 on the interference table, and overloaded
  items are re-checked after every short/long rest via `notifyOverloadedItemsOnRest`.
  Of the five `magicCapacityRules`, only `freeEffect` and `dcRiseThreshold` are automated;
  `opposedStatesCountAsOne` and `makerForeknowledge` are advisory, with the manual ±1
  `material.mcAdjust` as the escape hatch.
- **`EFFECT_HANDLING` is the authoring↔consumption contract.** Every effect type is registered
  with a `consumer` (`projection` / `modifier` / `roll` / `power` / `reference`) and a note
  saying what actually happens. It exists because the alternative failed silently: 34 of 72
  materials once carried an effect that normalised cleanly, rendered a tidy sentence in the item
  modal, and changed no number anywhere. ⚠️ **Adding an effect type without registering it fails
  `CharacterSheetMaterialEffectHandling.test.js`**, which walks all 72 materials. `reference`
  means "deliberately a DM call" and is capped by that test — pushing past the cap forces the
  question to be argued rather than assumed.
- **`degradation` and `instability` are siblings, matched by one shared `_matchesTrigger`.**
  Degradation hurts the **item**; instability hurts the **carrier**. Same trigger vocabulary
  (`{on: "attackRoll", natural, alsoOnCriticalHit}` / `{on: "damageTaken", damageType}`), same
  `materials_degradation` sub-toggle, same offer-never-apply doctrine. Instability effects are
  `{type: "selfDamage", damage, damageType}` or `{type: "save", ability, dc, onFail}`; self-damage
  goes through `takeDamage` so the carrier's own resistances apply.
- ⚠️ **`damageTaken` triggers are fired from `charactersheet.js`, not the combat hook.** The
  post-attack hook only ever passes `attackRoll`. For a long time nothing passed `damageTaken` at
  all, so Rimeglass's authored fire degradation was matched-but-unreachable. Damage-triggered
  reactions now come from `_pOfferMaterialDamageReactions()` on the Damage flow. That flow's
  damage-type prompt is also driven by `getMaterialReactiveDamageTypes()`, not just by the
  character's resistances — otherwise a character with no defenses can never provoke one.
- ⚠️ **Raw item vs projected item is the single most common material bug.** A material's numbers
  land on the *projection* (`applyToItem`), so any accessor that reads `invItem.item || invItem`
  cannot see them. This bit `getEffectiveItemBonuses().critThreshold`, which reported 20 for an
  Orichaline katana while the projected item said 19 — on the combat tab, not just in export.
  Read the delta from `projectItemMaterial(item)` rather than re-deriving it from the axis, so
  `applyToItem`'s clamps and degradation's `zeroedAxes` come along.
- ⚠️ **Material crit and the `Critical: Spiked` upgrade are independent sources.** They must
  combine exactly once (20 − 1 − 1 = 18). Comparing them instead of summing silently drops the
  material's point whenever an upgrade already took one. Clamp after both, never inside one.
- ⚠️ **Two vocabularies describe armour category and neither is going away.** The 5etools
  catalogue uses `type: "HA" | "MA" | "LA" | "S"` (sometimes suffixed, `"HA|XPHB"`); the
  custom-item builder writes `type: "armor"` with a separate `armorType: "heavy"`. Code that
  knows only one silently ignores half the inventory — that is how Adamantine's damage reduction
  came to do nothing on every hand-built plate. Use `CharacterSheetState.getArmorCategory(item)`.
- ⚠️ **Every projection field needs a matching inverse in the item builder.** `applyToItem` writes
  numbers onto the item; `itembuilder-core.js`'s `_deprojectLegacyProjection` subtracts them back
  out. `thrownRangeDelta` shipped without one, so a Skyshard dagger gained 20 feet of thrown range
  on *every* round trip, permanently. The inverse runs in the opposite order to the projection
  (projection scales then shifts; de-projection unshifts then undivides). If the projection is
  lossy, register it in `_getLegacyDeprojectionAmbiguities` instead of reversing it.
- **`getMaterialEffects(item, material)` resolves internally now**, like `applyToItem` /
  `getMaterialNotes` / `getPenetration`. Before, a forgotten second argument returned a fully
  populated *empty* shape, indistinguishable from a material with no effects.
- ⚠️ **A test that touches materials without `setItemMaterialCatalog` does not test materials.**
  Items store a `{name, source}` *reference*; the entity lives in the catalog. With no catalog,
  `resolveMaterial` returns `null` — the same answer as "this item has no material" — so every
  effect silently evaporates and the test passes against an arbitrarily broken implementation.
  Two sessions each concluded Adamantine's damage reduction was unimplemented this way; it was
  working the whole time. `resolveMaterial` / `resolveResonance` now record unresolved references
  (`CharacterSheetMaterials.getUnresolvedReferences()`) and **`poolSize` tells you which bug you
  have**: `0` means the catalog never loaded and *every* material is dead; non-zero means this one
  reference is bad. Load the real brew from `homebrew/TravelersGuidetoThelemar.json`.
- ⚠️ **`item.attachedSpells` is a dict far more often than an array** (~343 vs ~84 in the
  shipped catalog). `will` / `other` / `ritual` hold arrays directly; `daily` / `charges` /
  `limited` / `rest` nest one level further under a use count (`{"1e": [...]}`); and a
  sibling `ability` key holds a bare **string**, not spells. `charactersheet-inventory.js`
  both copies the dict from the catalog onto matched items (`:166`) and *constructs* it for
  custom items (`:4044`). Read it via `CharacterSheetMaterials._flattenAttachedSpells`,
  which collects only strings living **inside an array** — covering every shape in one rule
  and excluding `ability` for free. Assuming an array here caused a real crash that took out
  the material picker, the inventory row render and the rest flow at once.
- **`state.getMagicCapacityStatus` is a guarded choke point.** It try/catches and returns
  `null`; all three callers (picker preview, `_renderItemRow`, `notifyOverloadedItemsOnRest`)
  already treat `null` as "no capacity to show", so one unfamiliar item costs a badge rather
  than a whole render. Don't add try/catch to the render paths instead — that hides bugs.
- An effect's authored `note` **replaces** the generated summary unless it carries
  `"noteMode": "qualifier"`, in which case it is appended. `grantsAction` is exempt.
- **`getSummary(material, item)` is item-aware — always pass the item.** It gates each axis
  by the same rule `applyToItem` uses (`Dmg`/`Crit`/`Pen` → weapon, `AC` → armour, `MC` →
  always). Omitting `item` lists everything, which reads as nonsense in a picker row: a
  longsword used to advertise `Mithril — AC 18`. `applyToItem` matches — no `critThreshold`
  is written onto armour, where nothing rolls against it.
- **The material picker is a filter-first disclosure list, not a hover preview.** 65 options
  means search leads: an auto-focused filter box matches name, category, summary **and** note
  text; each row is a native `<button>` whose expanded panel holds the diff and the *only*
  Apply button on screen. One category group is always open. Never reintroduce hover preview
  — it cannot work on touch.
- **Inventory-row chips carry an accessible name, not just a `title`.** Build them with
  `getMaterialBadgeAriaLabel(material, item)` and `getMagicCapacityAriaLabel(material,
  status)`; never let a chip's meaning live only in `title=`, which is mouse-only. The
  glyphs (`⚙ ✦ ⚠`) are `aria-hidden` — a screen reader otherwise announces "black
  four-pointed star" — and ratios are spelled "4 of 6", not "4/6".
- ⚠️ **The `✦` capacity chip is a `<button>`, not a click-handled `<span>`.** It opens the
  Magic Capacity modal, so it needs tab order, Enter/Space and a focus ring. Its UA styling
  is reset in CSS (`font: inherit; background: none`) so it sits flush with the inert chips
  beside it, and under `pointer: coarse` all three chips share a 44 px minimum.
- **Risk is derived from `degradation`, never from a material name.**
  `getRiskFlag(material)` returns `null`, `{tier: "degrades"}` or `{tier: "destroys"}` —
  `destroys` only when the authored block sets `destroys: true` (today: Ordinary Glass alone).
  It renders in the picker row *and* as the first element of the detail panel, ahead of the
  numbers that made the material tempting. Adding a sixth degrading material needs no code.
- **Every material apply and clear raises an undo toast** via `_offerMaterialUndo(itemId,
  prior, label)`. Capture `prior` **before** mutating; `null` is a legitimate value and
  reverting must restore the *absence* of a material. The host toast dismisses itself on any
  click inside it, so the Revert button can never swap itself into a "Reverted" label — fire a
  second short toast to acknowledge, or the revert lands silently.
- ⚠️ **Status colours must read `var(--cs-<sem>-text, var(--cs-<sem>, …))` and tint with
  `color-mix()` off the same token.** Semantic ink on a tint of its own hue fails silently:
  change the fill hue elsewhere and text and background move together, so the chip still looks
  deliberate while dropping under AA. `--cs-*-text` is theme-scoped in
  `charactersheet-modern.css` (darker in day, lighter in night); collapsing the chain to one
  token, or hardcoding an `rgba()` tint, reintroduces the bug.
  `CharacterSheetMaterialsContrast.test.js` reads the real tokens and guards every pair.
- **The MC breakdown must never print raw property names.** `_BONUS_KEY_LABELS`,
  `_ABILITY_KEY_LABELS` and `_SPEED_KEY_LABELS` translate them via `_labelKeys`; an unmapped
  key falls through verbatim on purpose, because hiding it would make the detail line
  unreconcilable with the count beside it.
- **A dormant condensate affinity distinguishes reachable from unreachable.** If the item kind
  can host the affinity's role it says "switch its role to claim it"; if it cannot — a
  rootstone sword, authored for a protective layer a weapon has no slot for — it says the
  affinity never applies. Never phrase an unreachable role as a condition the player could go
  and satisfy.
- **Picker sort metrics must return `null`, never a stale base number.** `getSortMetrics(item,
  material)` nulls an axis the item kind cannot express (AC on a longsword) *and* an axis the
  material cannot move — a price quoted per scale or marked `isPriceless` leaves the item's own
  value in place, so ranking on it would file every priceless material under "cheapest".
  `null` sinks to the bottom of the sort; the material stays eligible. `∞` is `Infinity` and a
  suppressor is `-Infinity`, so both sort naturally.
- **An explicit sort flattens the list.** Sorting and category grouping answer different
  questions; a "best damage" ranking split across eight collapsed headers ranks nothing.
  `getSortOptions(item)` gates which axes are even offered, on the same item-awareness rule
  `getSummary` follows.
- ⚠️ **The picker's empty state must branch on `getMaterials().length`.** "Nothing fits this
  item" and "the catalog never loaded" are indistinguishable from inside the modal, and the
  default message blames the item for what is really a homebrew-loading failure.
- ⚠️ **Picker rows need `flex-wrap`.** A row carries a name, a summary and up to two
  `white-space: nowrap` chips; at 390px they cannot share a line. Without wrapping the summary
  collapses to one word per line *and* the chips overflow the modal. The summary needs a
  flex-basis (`14ch`), not `auto`, or it is crushed instead of dropping to its own line.
- **Do not put a destructive control under the modal's ✕.** The clear-material trash used to
  sit directly beneath it; it is now a labelled `Remove` button beside the material's name,
  with a second in-context one inside the expanded detail panel.
- **The picker carries its own glossary.** `MC`, `MC ∞`, `MC −∞`, `✦`, `Pen`, `Crit` and the
  condensate roles are vocabulary this feature invents; outside the 678-line rules document the
  collapsed `<details>` at the foot of the picker is the only place they are defined. Adding a
  new abbreviation to a row means adding it there too.
- ⚠️ **Only upgrades authored `isMagical` count toward Magic Capacity.** Most upgrades are plain
  smithing — Balanced, Brutal, Sharpened, Silvered, Masterwork, the armour proofings — and
  counting all of them filled items up with craftsmanship before a single enchantment landed.
  Magicality is data on the entity, never inferred from effect shape (Balanced grants +1 attack
  and is mundane; Enchanted grants +1 spell attack and is not — the shapes are identical) and
  never a hardcoded name table (which would miss every homebrew upgrade). Flagged today: the
  three site upgrades Enchanted / Magical / Arcane, all 39 `GS:*` gemstone powers, and the four
  brew `AU` tags that grant damage resistance. *Gem Socket* is a fitting, not magic; the gem set
  into it is counted separately.
- **`applyItemUpgrade` snapshots `isMagical`, so the hot path never hits the catalog.**
  `_recalculateItemBonuses` runs on every equip toggle. Saves written before the field existed
  carry nothing, so `getMagicCapacityStatus` injects `CharacterSheetUpgrades.isUpgradeMagical`
  as a resolver — snapshot flag first, catalog second. It reads the resolver off `globalThis`
  rather than importing it, so materials keeps no hard dependency on upgrades.
- ⚠️ **Magicality fails open.** An upgrade that resolves to nothing counts as NON-magical. The
  opposite default would let a missing brew silently overload every item a character owns.
- ⚠️ **`item.damage` is a display string FROZEN at add-time.** It is written only in `_addItem`
  and in custom-item creation, and nothing rewrites it — `projectItemMaterial` writes `dmg1`. Any
  surface that reads it shows a modified weapon's *printed* damage forever. Use
  **`state.getEffectiveWeaponDamage(itemId)`** instead: it reads the projected item and folds in
  `getEffectiveItemBonuses`, so materials, die steps and flat upgrade bonuses all land. Returns
  `null` when there are no dice — render nothing rather than inventing a line.
- ✅ **`getEffectiveItemBonuses` returns NUMBERS and exposes folded totals.** Item data authors
  bonuses as signed strings — all 190 `bonusWeapon` values in the site catalogue are `"+2"`-style,
  as is every `bonusAc` and `bonusSpellAttack` — so `(eff.bonusWeapon || 0) + (eff.bonusWeaponAttack || 0)`
  used to concatenate and report `"2200"` for a +2 weapon with three upgrades. The derivation now
  coerces every numeric field (unparseable → `0`, never `NaN`).
  **Read `totalAttackBonus` / `totalDamageBonus`, not the parts:** `bonusWeapon` applies to BOTH
  axes, and twenty-one call sites across four modules each had to remember that. The per-axis
  fields remain for anything that genuinely needs one axis. An unknown id still returns `{}`, so
  `|| 0` guards and `() => ({})` test stubs hold.
- **`getEffectiveWeaponDamage().display` excludes damage riders; `displayFull` includes them.**
  The inventory row renders riders in their own warning-coloured chip and would print them twice
  otherwise. `isModified` compares against the **raw** entry, not the projected one — comparing
  against the projection makes a material's die step look standard.
- **`CharacterSheetUpgrades.getUpgradeSummary(upgrade)`** is the single one-line description of
  what an applied upgrade does (`"Balanced: +1 attack"`). Extracted from an inline builder in the
  inventory renderer because the row badge, the hover and the picker all need the same sentence.
- ⚠️ **Bootstrap's global `.badge` is a 2.5rem circular puck with no background** (`border-radius:
  50%`, `min-width: 2.5rem`, and `-warning` / `-info` / `-default` define no `background` at all).
  Multi-word labels render as stretched empty ellipses. Item-row upgrade badges therefore use
  `.charsheet__item-upgrade-badge`, not `.badge badge-warning`; the three item modals carry a
  scoped override instead. Do not "fix" the global — the rest of the site depends on it.
- ⚠️ **A materialled / upgraded / socketed item is NOT a catalog hover target.** It is no longer
  what `items.html` describes, so `isCatalogItemHoverTarget` returns false for it and it falls
  through to `buildItemInlineHoverEntry`. `_addItem` copies `entries`, so the printed prose is not
  lost. **`hasCatalogItemIdentity` is the separate predicate** for "does this resolve in a loaded
  catalog" — an item can have an identity while no longer being what that entry describes, which
  is what lets the inline entry end with an `{@item}` link back to the printed version.
- ⚠️ **A plain catalog item must keep taking the catalog path.** This is the regression to guard
  when touching hover routing: verify a pristine item side by side and confirm it still renders
  the full statblock, not the inline entry.
- ⚠️ **Never hand-roll `{@item …}` for an item name — call `buildItemHoverNameHtml`.** The Combat
  tab did, and so opted out of the whole routing above: custom weapons got a link resolving to
  nothing, modified ones got the pristine catalog entry. Only pass it something that IS an item —
  a feature or spell attack resolved against the item catalog is just a different broken link.
- **State publishes itself as `globalThis.__csState`** from its constructor. The item hover
  builders in `charactersheet-class-utils.js` are pure statics called from a dozen render sites
  with no state reference, and they need `getEffectiveWeaponDamage` / `getItemMaterialEntity`.
  Mirrors `__csMaterialCatalog` / `__csResonanceCatalog`. `window.charSheet` exists but is
  explicitly labelled a debugging handle — do not build on it.
- ⚠️ **Several upgrade `notes` are authored self-labelled** (`"Brutal: Reroll max damage dice…"`),
  so `getUpgradeSummary` strips a redundant `"<name>: "` prefix before prepending the name.
  Without it the hover read `"Brutal: Brutal: Reroll…"`.
- ✅ **Exploding dice are authored, not name-checked.** `explodingDamageDice: true` on the catalog
  entity flows descriptor → merge → aggregation → `getEffectiveItemBonuses.explodingDamageDice`,
  so homebrew can grant it without code. Boolean descriptor props merge by **OR** (a later plain
  upgrade must not revoke it), unlike the numeric props, which sum. `_explodeDamageDice` in
  combat mutates a `_parseDamage` result in place — total, animation groups and roll log all
  update for free. It touches ONLY the weapon's own roll (riders/sneak/Doubleshot are separate
  `_parseDamage` calls), skips maximized rolls (Destructive Wrath *sets* max, doesn't roll it),
  is bounded by `maxExplosions`, and refuses `sides < 2`. Crit dice are already doubled into
  `rolls` before it runs, so one pass explodes them correctly with no double-explode risk.
- ⚠️ **A single-valued picker closes on apply; a multi-valued one must not.** A material is one
  field, so `showMaterialPickerModal` closing is correct. `showUpgradePickerModal` is a *list*
  editor — a weapon takes several upgrades — so it rebuilds its body in place via `renderBody()`
  after every apply / remove / unsocket and exits only through an explicit **Done**. The
  consequence is structural: nothing in that body may be captured before the build. The eligible
  list, the applied list, `getTotalGold()` and the socketed gemstones are recomputed inside
  `renderBody()`, and the cost-bypass choice — whose checkbox is destroyed on each rebuild — is
  mirrored into an `isOverrideSticky` closure flag and re-rendered back onto the box. Bind the
  click delegation to the `content` element that `renderBody()` **empties** rather than
  replaces, or the handler dies on the first rebuild.
- **A re-rendering list cannot use zebra stripes.** Once the upgrade picker rebuilds in place, an
  alternating fill means a row changes colour merely because the list above it grew, which reads
  as a state change that did not happen. Rows separate via an inset hairline instead.
- ⚠️ **Bootstrap's global `.badge` is a 2.5rem circular puck** (`border-radius: 50%`,
  `min-width: 2.5rem`) built for single-digit counters, and `.badge-info` / `-default` /
  `-warning` / `-secondary` / `-success` define **no background at all** — white text on
  transparent. Multi-word tier labels ("1st Tier Weapon") therefore rendered as giant empty
  ellipses. The character sheet's modals scope a pill-shaped, ink-on-tint override; reuse it
  rather than reaching for the global class.
- ⚠️ **The MC headline modifier is `--overloaded` / `--suppressing`; the inventory badge's is
  `--over` / `--suppress`.** They are different elements with different vocabularies, and
  writing `.charsheet__mc-headline--over` (which matched nothing for as long as it existed)
  is the exact mistake to avoid.
- ⚠️ `addItem()` **stacks same-named items**, so a material applies to the whole stack.- **Elemental condensates** (`materialCategory: "condensate"`, 18 of them) are **role-gated**:
  the affinity's mechanics only fire while the material occupies its own role
  (`strikingSurface` / `protectiveLayer` / `focus`). Only weapons are ambiguous, so only
  weapons get a role selector. The **instability is never gated**. Override via
  `state.setMaterialRole(itemId, role)`; read the resolved one with
  `CharacterSheetMaterials.getActiveRole(item, material)`.
- **Draconic Domain Resonance**: the four dragon materials carry a `draconicResonanceSlot`
  effect; the wielder picks one of **18** resonances (9 Fear + 9 Safety) via
  `state.setDraconicResonance(itemId, {name, source})`. The choice lives at
  `item.material.resonance`, so swapping the material voids it. Once chosen it **replaces**
  the "May carry 1 …" note, typed `drawback` for Fear and `passive` for Safety. Resonances are
  shared reference data, not a browsable entity — `globalThis.__csResonanceCatalog` on the
  sheet, `globalThis.__craftingDraconicResonances` on `crafting.html`.
- **Dragon Blood's Twelve Uses are already implemented** as variant spell components in
  `charactersheet-spells.js` (`_pChooseComponentUses`), backed by the four
  `Distilled Dragon's Blood` items with `usesPerCasting` 1–4. Do not rebuild them.
- **Ioun Sand makes any item an Ioun host**, detected by the material's structured
  `doubleNumericProperties` effect (never by name). `getIounHostPolicy` applies
  `_applyIounMatrixOverlay` *on top of* its four detection layers, so sizing a matrix from
  the ⚙ editor still doubles. A matrix grants no bonus of its own — `perStone` is zeroed and
  `grants` emptied unless the base layer reported `isBonusDeclared`.
- **The doubling is materialised onto the stone row**, mirroring `_recomputeIounHostBonuses`:
  `_recomputeIounMatrixDoubling` captures pristine values in `stone.iounMatrixBaseBonuses`
  (with a `__hostId` key so only the responsible host unwinds it) and always reads *from* the
  capture, so it is idempotent. Only the 13 props in
  `CharacterSheetState.IOUN_MATRIX_DOUBLED_PROPS` are doubled; prose ranges/areas/durations
  are the DM's call.
- **`CharacterSheetState.isIounFragment` is name-based and load-bearing in exactly two
  places**: a matrix never doubles a fragment, and Ioun Crystal's `freeEffect` MC rule belongs
  to fragments alone (enforced generally by
  `CharacterSheetMaterials._isMcRuleFormApplicable`, which matches a rule's `appliesTo`
  *form* against the item name). Ioun Geodes are reference prose only.
- **Degradation is declared, never named.** Five materials carry a `degradation` block
  (Stone and Flint / Obsidian / Duststone step Damage down, Rimeglass zeroes Protection and
  Critical on Fire damage, Ordinary Glass is destroyed on a nat 1 *or* a crit). The three
  `effect.type`s are `damageStepDelta`, `zeroAxes` and `destroy`.
- ⚠️ **Degradation is summed into the material's own axes before projection**, not layered
  after it: `applyToItem` adds `damageStepDelta` to `material.damage` and steps the die
  ONCE, because stepping twice rounds differently through the ladder's off-ladder rungs.
- **Nothing is auto-applied.** The `materialDegradation` post-attack hook only offers; the
  player confirms. It is scoped to `ctx.attack.sourceItem.id` (the weapon actually swung),
  excludes spell attacks, and skips already-destroyed items.
  `state.degradeItemMaterial` / `repairItemMaterial` / `getShortRestRepairableItems` are the
  state API; `offerShortRestRepairs()` is called from `charactersheet-rest.js`.
- `materials_degradation: false` suspends the **effect** but keeps the recorded stacks, so
  toggling it back on restores the degraded numbers exactly.
- **Object Durability and Magical Interference are `variantrule` entries in the brew**,
  allowlisted in `extract-rules.js`, rendered on `crafting.html` only. ⚠️ The interference
  table is a **mirror** of `CharacterSheetMaterials.MAGICAL_INTERFERENCE_TABLE`; a drift
  guard in `test/jest/CraftingItemMaterials.test.js` pins them together.

Full documentation: `docs/charactersheet/21-item-materials.md`.

## NPC Exporter

**Files**: `charactersheet-npc-exporter.js` (pure converter), `charactersheet-export.js` (dialog).  
**Docs**: `docs/charactersheet/18-npc-export.md`  
**Tests**: `CharacterSheetNpcExporter.test.js` + `.matrix.test.js` + `.materials.test.js` + `.realsaves.test.js` (contract tests against a corpus of 24 full saves in `npc-exports/`; auto-skips when those untracked fixtures are absent)

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

### Weapon damage must come from the sheet's own breakdown (v21)

The exported flat on a weapon line is **`abilityMod + base + feature + item`** from
`state.getWeaponDisplayDamageBreakdown(attack)` — the same helper the combat tab, play mode
and the sheet header render from. Two rules follow, and both have tests.

- **Never fold `state` / `rage` / `hybrid` from the breakdown.** Those are situational, and
  the v15 rider system already prints them as conditional clauses on the same line (`plus 2
  damage while raging`). Folding `.total` hides the condition *and* double-counts.
- **`getWeaponDisplayDamageBreakdown` reads `sourceItem`, not `_sourceItem`.** The exporter's
  own convention is the underscored name; `_attackMatchesWeaponBaseItems` is not. Pass an
  attack shaped like combat.js's `autoAttack`: `{id, name, abilityMod, damageBonus, properties,
  range, sourceItem}` where `damageBonus = eff.totalDamageBonus + (item.customDamageBonus||0)`.

**Two traps this replaced.**

- **`CharacterSheetUpgrades.increaseDamageDie(damageDie, steps)` returns the die and nothing
  else.** `"2d6+15"` comes back as `"2d8"` — flat bonus, damage type and rider clause gone,
  silently. Extract the bare die (`/^\s*(\d+d\d+)/`) before calling it. The sheet's two
  callers already pass bare dice; the exporter was the sole misuse.
- **`state.updateAttackFromWeapon()` is legacy and the exporter is its only production
  caller.** It folds `customModifiers.damageBonus` — dead save data (`setCustomModifier` has
  zero callers in `js/`, present in 10 of 24 corpus saves) — and knows nothing about named
  `"damage"` modifiers or weapon-scoped item bonuses. Use it for `name` / `abilityMod` /
  `properties` / `range` / the base die; **never for the damage total**.

Both branches of `_getMergedAttacks` must stay in step, including reading
`eff.totalAttackBonus` / `eff.totalDamageBonus` rather than raw `eff.bonusWeapon*`. No corpus
character exercises the first branch, which is precisely why it silently drifted.

### Materials and upgrades reach the statblock (v22)

Materials and upgrades are stored as **references** and resolved at read time, so anything
that reads `getInventory()` / `_data.inventory` sees the *base* item. That was both reported
bugs: the statblock had no material awareness at all, and `buildCompanionItems` bundled an
item measurably weaker than the block was built from (Angelic Plate AC 18 vs 21, Cataclysm
`2d6` vs `2d10`).

- **Read the projection, never the store.** `getItems()` for material projection,
  `getEffectiveItemBonuses(id)` / `getEffectiveWeaponDamage(id)` for upgrade composition.
  There were 21 sites independently re-deriving a weapon's total; do not add another.
- **`CharacterSheetMaterials.getMaterialEffects(item, material)` does NOT resolve its own
  material.** Called with one argument it returns a fully-populated **empty** shape instead
  of throwing, so a forgotten `resolveMaterial(item)` is indistinguishable from a material
  with no effects. Always `getMaterialEffects(item, Materials.resolveMaterial(item))`.
  (`applyToItem`, `getMaterialNotes` and `getPenetration` *do* resolve internally — the
  inconsistency is the trap.)
- **Routing follows the standing doctrine.** Roll-affecting effects go on the **attack
  line** (penetration, crit threshold, magical/silvered tags, the damage-type *option*,
  material riders); save/check advantage folds into the `Resilience` trait with
  per-source attribution; non-roll properties go to `Armor Traits` or the bundled item's
  `entries`. `CharacterSheetMaterials.EFFECT_HANDLING` is the routing authority and an
  exporter test fails when a type has no home.
- **`requiresProperty` is a hard gate**, not an availability hint — Stout Blackwood's crit
  die exists only on a Loading weapon. `getMaterialEffects` enforces it only inside its
  `grantsAction` case, **never** for `bonusCritDamage`, so the exporter's own gate is
  load-bearing.
- **Penetration is an AC mechanic** (near-miss), *not* resistance-piercing. The in-app
  glossary at `charactersheet-materials.js:1892` said otherwise until `9dbdc5b9`; all three
  places that describe it are now pinned by tests, on both sides.
- **Bake, then describe.** Bundled items carry baked numbers and no `material` /
  `appliedUpgrades` refs — `additionalProperties: false` forbids them and a reference is
  inert (or double-applies) on a receiving instance. Provenance survives as `entries` prose.
- **Multiattack scores the rendered attack**, summing every `{@damage}` clause on the
  finished line (once-per-turn riders excluded), because `attack.damage` holds only the
  weapon's own die. Also fixes monks, whose Unarmed Strike row omits the ability modifier.

### Material riders say what they do (v23)

Three semantics the sheet pinned in `9dbdc5b9` that the exporter had guessed at. All three
were **latent** — no corpus character carries the materials or the feat involved, so the
regenerated 24-character corpus moved zero characters. Output diffing could never have
found them.

- **"One additional weapon damage die" is one die**, not another copy of the expression: a
  maul rolling `2d6` adds `1d6`. `CharacterSheetCombat._getSingleWeaponDie` is the
  authority. On 1-die weapons the wrong arithmetic gives the right answer, which is how it
  shipped and why a fixture must be chosen that can distinguish the hypotheses.
- **A die granted BY a crit is not doubled by that crit** (Brutal Critical precedent). The
  statblock has to say so, because prose that omits it reads both ways and there is nobody
  to ask.
- **`noRangedDisadvantageInMelee` is `reference` on the sheet but mechanical here.** The
  sheet has no positional model, so it can never impose the disadvantage this suppresses;
  a statblock reader knows where the creature is standing. This exporter is the effect's
  one legitimate consumer, and the same applies to the identically-shaped
  `ranged:noDisdvantageInMelee` (Crossbow Expert) — both route to one attack-line sentence.
- **A registered modifier is not a delivered modifier.** Measured: a character holding
  Crossbow Expert aggregates **nothing** for `ranged:noDisdvantageInMelee`; the effect never
  reaches `namedModifiers`. Read `globalThis.FeatureEffectRegistry.getFeatEffects(name,
  source)` instead — it keys on the same authored data, so any feature granting the effect
  is picked up rather than one hardcoded name.

### A material power's action economy is authored, not inferred (v24)

`getItemPowers()` carries an authored `actionType` on every material-granted action. Read it;
do **not** infer the economy from the power's prose.

Five of the nine `grantsAction` effects in the brew declare one (Tideglass and Stormprism
react, Smokestone is a bonus action, Sunprism an action, Ashglass reacts). None of their notes
*says* so, because the field is right there — they state the trigger instead ("When an attack
hits you..."). A prose scan therefore returns `null` for all five, and they file as traits.

- **`"special"` is filler, not data.** The accessor emits `actionType: act.actionType || "special"`,
  so `"special"` means the brew declared nothing. Fall back to prose there — that is how
  Yellowwood's Flurry still reaches the bonus-action section off its own wording.
- **`isReferenceOnly` is a statement about the *sheet*, not about the rule.** It means "no
  button can express this" (Yellowwood's Flurry rides on the Attack action). A statblock
  reader is not a button. Do not use it to suppress an economy.
- **The `requiresProperty` gate is applied upstream only for `grantsAction`.** `getMaterialEffects`
  checks it at `materials.js:513` inside that case and nowhere else, so a consumer of
  `bonusCritDamage` must check the property itself.
- **`getNamedModifiersByType("damageReduction")` is ordering-sensitive.** It returns `[]` when
  the material catalog is set *after* `loadFromJson`, and the real modifier when set before.
  Any headless probe must call `setItemMaterialCatalog` first or it will measure a phantom.

### Armour tier has two vocabularies — always resolve, never read a field (v26)

`CharacterSheetState.getArmorCategory(item)` is public and understands both shapes:

- catalogue armour — `type: "HA" | "MA" | "LA" | "S"`, usually **no** `armorType`
- item-builder armour — `type: "armor"` with `armorType: "heavy" | "medium" | "light"`

Reading either field alone mis-reads half the inventory, and each half looks correct to whoever
tests it. This produced two mirror-image bugs in the same week: the sheet's DR gate read only
`type` and dropped DR on every custom plate; the exporter read only `armorType` and printed
heavy-tier DR on catalogue *light* armour and on adamantine *weapons*.

Two rules that follow:

- **Return `null` for non-armour and treat it as a real answer.** A tier-scoped note
  ("Adamantine (heavy)") is not true of a sword. Treating "unknown" as "applies" is what put
  armour prose on a weapon.
- **Never fall back to the first entry of a tiered list.** `fx.damageReduction` is authored per
  tier (Adamantine: heavy-3, medium-2). A `|| list[0]` fallback hands light armour a reduction
  the material never grants — inventing a defence, which is worse than omitting one.

**Use the gate, do not re-derive it.** `CharacterSheetMaterials.damageReductionApplies(item,
armorType)` is the single implementation; `CharacterSheetState._materialDamageReductionApplies`
delegates to it. The sheet's *note* path was ungated until v27 and so printed every authored tier
on every item — a plate reducing by 3 *and* by 2, and a longsword reducing damage at all — while
the modifier path beside it gated correctly. One subsystem granted one number and explained
another. Any new reader of `fx.damageReduction` must call the gate rather than loop the array.

Note why it survived review: with no gate, catalogue **heavy** armour still printed the right
number, because heavy is authored first. The case anyone checks first was the one case the defect
could not touch — and no character in the 24-save corpus carries a DR-bearing material at all, so
regeneration moved nothing either. A corpus proves only what it contains.

### A drawback goes where the benefit is (v25)

When the exporter prints a conditional benefit on an attack line, the condition that removes
it must go in the same parenthetical. Emberglass's fire-damage option shipped for two versions
without its suppression clause, because that text lives on the *bundled item* — and only
custom items are bundled, so a character wielding a catalog item saw the upside and nothing
else. A statblock reader has nobody to ask, so a split conditional is indistinguishable from
an unconditional one.

Two narrow helpers, both on the attack line:

- `_getInstabilityBackfireClause(sourceItem)` — reads
  `CharacterSheetMaterials.getInstabilitySpec(material)` and emits a clause only for a
  structured `{trigger: {on: "attackRoll", natural: [...]}, effect: {type: "selfDamage"}}`.
  Damage-triggered instabilities (Magmaheart) are excluded: they are not a consequence of the
  attack being made.
- `_getAffinitySuppressionClause(sourceItem)` — reads
  `sourceItem._materialEffects.condensate.instability` (free text) and emits only when it
  matches `/\bsuppress/i` and `isActive !== false`. Most of the eighteen authored
  instabilities are table calls about the item; printing them all would bury the two that are
  combat facts.

Two traps worth carrying forward:

- **`consumer` is a category, and a category-level test passes vacuously.**
  `condensateInstability` is declared `consumer: "power"` in `EFFECT_HANDLING`, so a test
  asserting "every consumer has a home" was green while the type reached no power channel at
  all. Name the mechanism **per type**, at least for consumers where a type can be forgotten.
- **`_getSafeInlineText` output still passes through the entry normaliser**, which rewrites
  `"; "` before a capital into `". "` (exporter line ~5459). Any clause appended after a
  semicolon must start lower-case or it will be cut into its own sentence.

### Pin the mechanism that works, not the one that looks responsible (v26c)

A guard is only worth what its RED verification proves. When pinning that a material's damage
reduction is stated once, the obvious culprit was the authored-vs-derived `if`/`else` in
`_getMaterialNoteClauses`. Making it **additive** — the exact mistake being guarded — left the
count at **1**. The real protection was elsewhere: `_getArmorTraitBlock` dedupes on the lowercased
description.

Two lessons:

- **RED-verify against the mechanism you believe in.** Had the test passed without that check, it
  would have "guarded" a branch that was never load-bearing while the actual protection stayed
  untested.
- **A dedupe must key on the form it renders.** That one keyed on the raw description but rendered
  with terminal punctuation stripped, so `"...by 3"` and `"...by 3."` were two notes. Any
  normalisation applied at render time must also be applied to the key.

And state a dedupe's ceiling in a test: text-identity dedupe collapses a duplicate, **never a
paraphrase**. It cannot substitute for one derivation having one surface.

Related: a channel that returns `[]` today makes a double-report guard pass vacuously. Assert both
channels are live before asserting the count.

### A helper written while looking at the bundle will be scoped to the bundle (v27)

Three separate material defects have now had the same shape: the code path reached **custom /
bundled** items and silently skipped catalogue ones. v25 (suppression text), the provenance
warning (v27), and the tier note before v26 all failed this way.

The cause is structural, not careless. `buildCompanionItems` is where item-shaped work naturally
gets written, and it is gated three times over — `_isCompanionItem`, a `tagged.has(name)` check,
and a `!tagged.size` early return. Anything added inside it inherits all three gates whether or
not that scope was intended.

**When adding item-level logic, ask which of those three gates should apply.** If the answer is
"none", it does not belong inside that loop.

Related: `resolveMaterial` returns `null` for an unsatisfiable reference *and* for an item with no
material. Any consumer that treats a bare `null`/`[]` as "nothing to do" cannot tell a healthy item
from a broken one — read `CharacterSheetMaterials.getUnresolvedReferences()`, whose `poolSize`
separates "catalog never loaded" (0) from "bad reference" (n).

### Route an effect by what it does, not by what published it (v28)

`getItemPowers` publishes every material-granted power on one channel, with
`actionType: "special"` standing in for "the brew declared no economy". Reading a section off
the prose is a reasonable fallback, but it silently defaults to `trait`, and two of the brew's
nine granted actions are riders on the wielder's own attack rather than separate things to do.

Both landed in Traits, where an attack-affecting effect is unfindable mid-combat — and one of
them, Deathglass's "one target damaged by **this item**", was worse than misplaced: a trait
belongs to the creature, not to a weapon, so the referent pointed at nothing. Putting the
rider on the attack line resolves it for free.

Two rules worth reusing:

- **Gate a re-route on "where would this have gone otherwise?"** Claiming only powers that
  would have become traits makes the change provably unable to steal a reaction or an action.
  A predicate that asked "is this rider-shaped?" alone would have been free to hijack a
  properly-sectioned power.
- **Key suppression on emission, never on a shared predicate.** Two passes applying the same
  test will disagree the moment one of them has an extra reason to skip — here, an item that
  produces no attack line — and the item ends up described by neither. Record what was
  actually printed and skip that. Same lesson as `provenanceWarned` in v27, hit twice in
  consecutive versions, which is what makes it structural rather than incidental.

Also: `_getSafeInlineText` strips `{}` and will quietly destroy a `{@damage}` tag. Prose bound
for a statblock goes through `_prepareFeatureEntriesForNpc`.

### Bundling sheet-authored items with the export (v20)

An NPC export is a homebrew document (`{_meta, monster: [...]}`), so it may also carry
`item: [...]`. It now does — for **sheet-authored items only**.

- **Predicate**: `item._isCustom === true` (or legacy `source: "custom"`). An ordinary
  catalog add never sets `_isCustom` (`addItem` only *consults* it to suppress
  stack-merging, `charactersheet-state.js:31646`), so this fires exactly for items with no
  home to resolve against.
- **Third-party brew is never copied** — `getExternalItemSources(monster)` names it in
  `getValidationIssues().notes` instead. Copying it would launder someone else's content.
- **The bundle is derived from the finished monster.** `buildCompanionItems(monster, state)`
  harvests `{@item Name|OURSOURCE}` from the converted statblock and intersects with the
  custom inventory. Bundle↔tag set equality is a corpus-wide test. Do **not** "simplify"
  this to iterate the inventory — that reintroduces drift.
- **Items are re-sourced to the NPC's export source** via `_getItemTag`, the single choke
  point for all six tag sites. `_rebuildCompanionItemSource(safeSource)` seeds the
  per-conversion static, beside `_rebuildSpellCastingTimes`.

**Sanitizer landmines** (`_getSanitizedBrewItem`):

- The item schema is `additionalProperties: false` with **111** legal props; a real sheet
  item carries ~68, of which ~17 survive. `ITEM_SCHEMA_PROPS` is pinned against
  `node_modules/5etools-utils/schema/site/items.json` by a test.
- **`typeCode → type` must win over the incumbent `type`.** The sheet stores
  `type: "weapon"`, which the schema's enum rejects. Also renamed:
  `requiresAttunement → reqAttune`, `properties → property`, `damage → dmg1` (never
  clobbering a real `dmg1`).
- Required fields are exactly `name`, `rarity`, `source` — `rarity` defaults to `"none"`.
- **Entries split on blank lines into one array element per paragraph.** `_stripHtmlTags`
  collapses `\s+`, and `\n` means nothing to the renderer; without the split a long magic
  item renders as one wall of text.
- **`itemPowers` is intentionally dropped.** The NPC's usable powers are already rendered
  into the monster itself; an item's actives survive as `entries` prose + `attachedSpells`.
  Do not "fix" this.

**The preview must resolve the links the payload promises.** The dialog renders before
anything is saved, so a bundled item exists only as a JS object — the `{@item}` link
resolves against an empty cache and the hover shows **nothing, silently**.
`_registerCompanionItemHovers(items)` (in `charactersheet-export.js`) seeds the cache:

```js
DataLoader._pCache_addToCache({allDataMerged: {item: forCache}, propAllowlist: new Set(["item"])});
```

- Same house pattern as the Ar8 variant-component items and `_registerLoadedHoverEntities`
  in `charactersheet.js` (see the rationale comment there). Synchronous — no first-hover race.
- **Called from `rebuildCompanionItems()`, not once.** The export source is part of an item's
  hash and the user can change it from this dialog.
- **Cache the copy, not the payload item.** The cache wants `__prop: "item"`; the item schema
  forbids it. A test asserts the payload object keeps exactly its schema keys.
- Feature-detects `DataLoader` and swallows throws — jest and headless callers no-op cleanly.
- **Item hashes are URL-encoded** (`hecate's%20dagger_csheet`). `getFromCache` with a literal
  space silently returns undefined; that produced two false negatives while debugging this.

**`getValidationIssues` returns three buckets** — `errors`, `warnings`, `notes`. Only the
first two toast. Informational dependency notices go in `notes`, because Download and Save
both toast whenever `warnings` is non-empty and ~20 of 24 corpus characters cite external
brew.

**TDZ**: in `charactersheet-export.js`, `getCompanionItems` must be declared **above**
`renderValidation` — `pApplySourceConfig()` runs and validates before the button handlers
further down exist.

### Action economy as a superscript mark (v19)
- **Every saved spell already carries `castingTime`** (`"1 action"`, `"1 bonus"`,
  `"10 minute"` — ungrammatical, must be normalised for display). The exporter reads it
  through `_getEconomyMark`, which emits `{@sup {@tip B|Bonus Action}}`. `@sup`
  recursively renders, so nesting `@tip` inside it makes the mark **name itself on
  hover** — that is what lets the notation ship without a legend.
- **Long times print the time, not a letter**: `Ceremony ¹ʰʳ`, `Scrying ¹⁰ᵐⁱⁿ`. The glyph
  carries no space (`10min`) so a superscript cannot wrap mid-mark.
- **Every readable time is marked, including plain actions.** The invariant that buys:
  *an unmarked roster line means the casting time could not be read* — never "probably an
  action".
- **A psionic entry name filed under Bonus Actions / Reactions gets no mark** — the section
  heading already states it. An entry with a long manifestation time is marked, because it
  lands under Actions where nothing else says so.
- **The mark is presentation, never identity.** `_stripEconomyMarks` runs at the head of
  `_normalizeFeatureKey` and `_getAnchorBareName`; without it a marked name normalises to
  `stasis field sup tip 10min takes 10 minutes` and matches nothing.
- **Any pass parsing "a parenthetical directly after a tag" must skip the mark.** Use
  `ECONOMY_MARK_RE_SRC`. Missing this in `_dropSpellOnlyFeatEntries` silently resurrected a
  feat entry that eleven versions of the exporter had correctly dropped.
- **Ordering is load-bearing**: mark first, provenance paren second —
  `{@spell shield|XPHB}ᴿ (Oath Spells)`. `_pickPreferredSpellTag` treats a trailing `)` as
  "carries provenance", so the reverse order spoofs that tiebreak.
- **`RendererMarkdown` has an `@sup` case** that prints the hover title
  (`*Misty Step* (Bonus Action)`) rather than degrading to a mute `B`.

### Representing a manifester as a monster (v18)
- **The published answer already exists.** *The Talent and Psionics* ships 27 author-written
  psionic statblocks (7 disciplines x Talent/Expert/Master, plus 6 named psions CR 7-29).
  None invents a psionics subsystem: all route powers through a `spellcasting` block named
  `Powers` plus ~6 real entries. Match them rather than designing something new.
- **Strain converts to `N/Day`, and the budget is one track, not the maximum.** Manifesting
  an `n`th-order power on a `dD` costs `E[strain] = (n(n-1) + 1) / D`; the sustainable
  budget is `strainMaximum / 3`, because strain effects bite per track (5 in a track is -5
  AC or Disadvantage on saves). Snap the result to the book's three bands - `will`,
  `3/Day`, `1/Day` - because a continuous model emits 8/Day and 6/Day, which appear nowhere
  in the book.
- **A power earns an entry only if it resolves in combat** (attack roll, saving throw, or
  damage). Everything else is a `{@psionic name|source}` roster line.
- **`feature.description` on a `psionicPower` holds only the Range / Manifestation Time
  headers.** Anything reading a power's mechanics must go through `modes[]` (see
  `_getPsionicModes`). Reading `description` does not throw - it silently finds nothing,
  which is how the CR model valued a level 20 psion's whole arsenal at zero.
- **Concentration is a property of the mode, not the power.**

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
- **Lore suppression must be a ratio, not an absolute.** `_dropMechaniclessLoreEntries`
  needs ≥ 250 chars, ≤ 2 mechanical sentences **and** ratio < 0.25. A "contains no
  mechanical sentence" test flagged 16 legitimate corpus entries, and the very entry it was
  built for (`Bladesinger Styles`) contains two false-positive mechanical sentences — a
  `{@skill Stealth}` hover and a modal buried in flavour.
- **A form block is split, not trimmed.** `_splitFormBlocksIntoAlternateForm` needs ≥ 4
  string lines, a `while transformed`/`in this form` connector that is neither first nor
  last, and ≥ 2 `{@b Label.}` paragraphs after it. Dzeiy matches; Angelic Avatar does not.
- **A restated rule is deleted only where it is a whole sentence.** In the maneuver roster
  Riposte's closing sentence goes, but Trip Attack carries the same rule *mid*-sentence
  with the on-hit trigger the next clause needs, so it is joined (`…, if the target is
  Large or smaller`) instead of cut. The strip runs while bodies are still imperative, so
  match both `add` and `it adds`.
- **`_linkSpellModifiersFromSpellcasting` skips innate blocks** — Metamagic applies to the
  class's spellcasting, and an innate list is a different feature with a different ability.
- **`_foldAttackActionTrailers` merges into the previous line when the trailer owns its own
  entry**, and only fires when both cost and repeat count parse out.
- **A replacement attack is synthesised from its parent's line, not from prose.**
  `_promoteReplacementAttacks` finds the parent attack via the entry name (`Starfire
  Katana — Starlight Arc`), swaps the target clause for the stated area and appends the
  power's own die. It needs all three — parent, area, damage — or it does nothing.
- **`_annotateToggledAttackRiders` matches `{@atk mw|ms}` only.** Reggu's Radiant Sun Bolt
  is `rs` and must not gain a melee-only rider. The pass also needs a parsed damage die,
  because reach-only has no number for the line to carry.
- **`_foldCountUpgradesIntoBase` is A0.3 in miniature.** `_foldImprovedEntriesIntoBase`
  requires a body opening on "In addition/Also/The", so it refuses `Improved Cunning
  Strike`, which is an *edit* to the base's count rather than an addition to it. The count
  pass rewrites `add one of the following` → `add up to two of the following` at the anchor
  and drops the dependent. Only fires when the improvement's whole body is the count claim.

### Numbers and subsystems (v16)
- **`_mergeResilienceTraits` runs twice, and the second call is load-bearing.** At its first
  site some claims are still in first person or still carry a level preamble, so the
  subject-anchored clause regex cannot see them. The late call (just before
  `_consolidateCostedOptionMenus`) must **absorb** an existing `Resilience` entry, or it
  mints a rival one.
- **Order inside `_getStandingDefenseClause` matters.** The flavour-prefix strip
  (`^[^.]*?\bthat\s+(?=(?:it|they)\s)`) is a *fallback only*; applied first it eats the
  relative clause out of "…saving throws **that it makes** to maintain Concentration".
- **A mixed trait is split, not swallowed.** `_extractStandingDefenseResidue` merges the
  roll clause and leaves the remainder; `Umbral Warrior` and `Clearsight Sentinel` carry a
  non-roll mechanic that must survive.
- **Attribution labels can carry their own parentheses** (`Stronghold Builder (1/LR)`),
  which nests as `))` and fails the v9 balance test. Strip a trailing `(…)` from the label.
- **Never split a bullet line at `{@b`.** `_splitAtInlineBoldLabels` skips lines opening on
  `•`, otherwise the split leaves a bare bullet and fails the "never truncates mid-sentence"
  contract.
- **`getSaveMod` ≠ `getSaveBreakdown().total`.** The former folds in Dark Augmentation, auras
  and stances; the latter is a display artefact. `_explainSaveBonusesOnResilience` names the
  difference, and skips when an aura entry already states the same number.
- **Poisons are `type: "gear"`**, which is why the magic-item gate in
  `_getSpecialEquipmentBlock` had dropped every one. `_POISON_FACTS` covers 14 published
  poisons; anything else is named without invented numbers.
- **`_foldFormTraitOntoLines` splits to sentences, then splits a sentence again** on
  `, and ` when it welds an advantage claim onto an unrelated bonus — otherwise placing the
  advantage silently discards Feral Might's `+2` to melee damage. A surviving fragment
  opening on a bare pronoun gets its subject restored.
- **It runs before `_tagBareDice`**, so the unarmed-strike clause must be matched on bare
  `NdX` as well as `{@damage}`.
- **Rogue CR: measure the whole corpus.** The acceptance test for
  `_getEvasiveDefenseMultiplier` / `_estimateBurstDamageCredit` was that *no non-rogue
  moves*. Juen 11 → 15, Missy 7 → 9, everything else unchanged.
- **`base/` in the session harness predates v15.** A structural difference against it is not
  proof of a regression — confirm against `git show HEAD:…` first.

### The modifier is on its roll (v17)
- **A parenthetical list cannot hold a name ending in a parenthetical.** `(Shadow Sneak
  (1/SR), Shadowbite)` fails the v9 balance test — strip a label's uses suffix before
  listing it.
- **"Every attack" ≠ "every attack in scope".** `_foldSituationalAttackBonuses` retires a
  trait only when no *in-scope* attack was missed; counting out-of-scope attacks as misses
  keeps every scoped trait alive forever.
- **A gate longer than 60 characters stays in its trait** and is referenced by name on the
  line. An attack line is not the place for a paragraph.
- **A rider condition true of every line it prints on states nothing.**
  `_isUniversalRiderCondition` normalises `on every melee weapon hit` to no condition, which
  is what lets two same-type riders merge into `2d8`.
- **`_getItemDamageRiders` blanks `sourceName` for a self-named rider** — right when it
  stands alone, wrong once merged. `mergeLabel` carries the attribution across the merge.
- **A trigger rider is the only fold allowed to cross sections**, and only from `trait`: a
  trait is the one shape that cannot be a turn's worth of action on its own. It must carry
  its **full** name — `bare()` drops `(1/LR)` and orphans the pool.
- **`_getStandingDefenseClause` sees raw tag text.** A claim written as
  `{@variantrule Disadvantage|XPHB}` never matches a literal `disadvantage`; match against
  `_getPlainMatchText(...)`.

### Dialog actions
Close | Refresh | **Copy JSON** | Download JSON | Save to Homebrew. In-dialog validation panel; Save blocked on hard errors.

### Tests
`CharacterSheetNpcExporter.test.js` + `CharacterSheetNpcExporter.matrix.test.js` (class × special-system matrix) + `.realsaves.test.js` (932 contract tests against the 24-save corpus; auto-skips when absent; 999 across all three files).

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
