# Toggle Abilities System

This document details the toggle abilities (active states) system that manages activatable features like Rage, Bladesong, and combat stances.

## Overview

Toggle abilities are features that can be activated and deactivated, providing temporary effects while active. The system handles:

- Standard D&D abilities (Rage, Wild Shape, Patient Defense)
- Wizard features (Bladesong)
- Blood Hunter hemocraft (Crimson Rite and Order of the Lycan's Hybrid Transformation)
- Way of the Astral Self manifestations (Arms, Visage, Body, and Awakened)
- XPHB Light Domain reactions and auras (Warding Flare and Corona of Light)
- Combat stances (from various homebrew sources)
- Custom/homebrew toggle abilities
- Automatic detection and categorization

---

## Architecture

### ACTIVE_STATE_TYPES

The core definition of all supported toggle ability types lives in `CharacterSheetState`:

```javascript
static ACTIVE_STATE_TYPES = {
    rage: {
        id: "rage",
        name: "Rage",
        icon: "💢",
        description: "Advantage on Strength checks/saves, resistance to B/P/S damage, +rage damage bonus",
        effects: [
            {type: "advantage", target: "check:str"},
            {type: "advantage", target: "save:str"},
            {type: "resistance", target: "damage:bludgeoning"},
            {type: "resistance", target: "damage:piercing"},
            {type: "resistance", target: "damage:slashing"},
            {type: "rageDamage", target: "melee:str"},
        ],
        duration: "1 minute",
        endConditions: ["No attack or damage taken for 1 turn", "Knocked unconscious", "Ended as bonus action"],
        resourceName: "Rage",
        resourceCost: 1,
        detectPatterns: ["^rage$", "enter.*rage", "you can.*rage"],
        activationAction: "bonus",
    },
    // ... more state types
};
```

### State Type Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Display name |
| `icon` | string | Emoji icon |
| `description` | string | Brief description |
| `effects` | array | Mechanical effects while active |
| `trigger` | object | Optional in-play control `{label, actionType, effectType}` backed by a matching active effect |
| `duration` | string | How long it lasts |
| `endConditions` | array | Ways the state can end |
| `resourceName` | string | Resource consumed (e.g., "Rage", "Ki Points") |
| `resourceCost` | number | Cost per activation |
| `detectPatterns` | array | Regex patterns for auto-detection |
| `activationAction` | string | Action type: "bonus", "action", "free", "reaction" |
| `requiresClass` | string | Class requirement (optional) |
| `requiresClassLevel` | number | Minimum level (optional) |
| `isGeneric` | boolean | If true, effects parsed from feature |
| `useFeatureDescription` | boolean | Show feature description instead of generic |
| `effectsBuilder` | string | Name of a `CharacterSheetState` method returning level-correct effects; overrides `effects` on activation |
| `requiresStates` | array | State type ids that must be active for this toggle to be offered; dropped automatically when a prerequisite ends |
| `endSave` | object | `{ability, dc, onFailure, label}` — a save rolled when the state ends |

### Astral Self state lifecycle

The four Astral Self manifestations are separate active states. Arms and Visage
can be activated independently, Body requires both, and Awakened activates the
complete set while deducting its five-point cost only once. Dependency teardown
is bidirectional: ending Arms or Visage ends Body and Awakened, while ending
Awakened ends all three components. Their `endConditions` also route through the
generic incapacitation/0-HP teardown path.

### XPHB Light Domain states

- **Warding Flare** is a one-attack reaction state. Activating it spends one use
  from the Wisdom-sized Warding Flare pool and records disadvantage for the
  triggering attack against the Cleric. At Cleric 6, the pool recharges on a
  Short or Long Rest and activation also rolls `2d6 + Wisdom modifier` temporary
  HP, with a direct Apply to Self control.
- **Corona of Light** is an action-activated, one-minute aura with 60 feet of
  bright light plus 30 feet of dim light. It spends one use from its
  Wisdom-sized pool, can be dismissed, and marks enemy saves against Radiance
  of the Dawn and Fire/Radiant-damage spells as disadvantaged while active.

Arms uses `variablePointSpend` so the level 6+ UI can offer Arms for one
Ki/Focus point or Arms plus Visage for two. Visage and Body expose resolved
`trigger` controls for speech modes and Deflect Energy; the trigger resolver
applies ranges, ability modifiers, and action-economy costs before rendering.

---

## Effect Types

### Advantage/Disadvantage

```javascript
{type: "advantage", target: "check:str"}        // Advantage on STR checks
{type: "advantage", target: "save:dex"}         // Advantage on DEX saves
{type: "advantage", target: "attack:melee:str"} // Advantage on melee STR attacks
{type: "disadvantage", target: "attacksAgainst"} // Attackers have disadvantage
```

### Numeric Bonuses

```javascript
{type: "bonus", target: "ac", value: 2}           // +2 AC
{type: "bonus", target: "ac", abilityMod: "int"}  // +INT to AC
{type: "bonus", target: "speed:walk", value: 10}  // +10 walking speed
{type: "bonus", target: "damage:melee", value: 2} // +2 melee damage
```

### Resistances/Immunities

```javascript
{type: "resistance", target: "damage:bludgeoning"}
{type: "resistance", target: "damage:fire"}
{type: "conditionImmunity", target: "frightened"}
{type: "speedReductionImmunity"}
{type: "forcedMovementImmunity", target: "ground"}
```

> **`damage:<type>` is the house convention, but since CS-BUG-050 it is no
> longer a *correctness* requirement.** Older guidance says a bare damage type
> (`target: "fire"`) is "silently inert". That is **stale** — it describes
> pre-CS-BUG-050 behaviour. `_damageTypeFromEffectTarget()`
> (`charactersheet-state.js:41064`) now normalises **both** shapes: it strips a
> `damage:` prefix when present, and otherwise falls back to
> `DAMAGE_TYPES.has(clean)`. Its sibling's doc-comment says so explicitly —
> *"de-duplicated and normalised across both target shapes"*.
>
> Measured: rewriting Umbral Form's `target: "damage:cold"` to a bare
> `"cold"` left `getResistances()` **unchanged** (still 11 entries, still
> containing `cold`); *deleting* the entry outright is what turns the
> behavioural test red.
>
> Practical consequence for anyone writing an active state: **keep using the
> prefix** for consistency and greppability, but do not expect a behavioural
> test to catch a missing one. If you want the convention enforced, assert the
> shape directly, e.g.
> `expect(info.effects.every(e => e.target.startsWith("damage:"))).toBe(true)`.

### Special Effects

```javascript
{type: "rageDamage", target: "melee:str"}     // Uses calculated rage damage
{type: "sizeIncrease", value: 1}              // Count as one size larger
{type: "replaceStats", targets: ["str", "dex"]} // Wild Shape stat replacement
{type: "note", value: "Description text"}     // Informational note
{type: "sneakAttackWithoutAdvantage", meleeOnly: true} // Waives the SA trigger
{type: "grantsActionBenefit", action: "disengage", source: "Fluid Step"}
```

#### `sneakAttackWithoutAdvantage`

Waives the usual Sneak Attack trigger (advantage, or an ally within 5 ft.)
for as long as the state is active. Read via
`canSneakAttackWithoutAdvantage({isMelee})`; `meleeOnly: true` restricts the
licence to melee attacks. The combat panel consumes it in three places —
the post-attack auto-enable, `_isSneakAttackTriggerSatisfied` (so the "no
advantage and no adjacent ally" warning stops lying), and the Sneak Attack
toggle's condition pills, which gain a `<StateName>: no advantage needed`
row.

First customer: the Belly Dancer's Dance of the Country ("you can make a
Sneak Attack against creatures within your melee range without the need for
advantage").

#### `grantsActionBenefit`

Grants the benefit of a named action (`"disengage"`, `"dodge"`, `"dash"`, …)
without spending the action. Read via `hasActionBenefitFromStates(action)`.
First customer: Fluid Step (Belly Dancer 13).

### Level-dependent effects (`effectsBuilder`)

A state type's literal `effects` array is static, but many features change
what the state *does* as the character levels (the Belly Dancer's Dance
gains a Disengage benefit at 13 and a Percussive Strike rider at 17).
Rather than special-casing each one at the call site, a state type may
declare an `effectsBuilder` — the name of a `CharacterSheetState` method
that returns the effect list:

```javascript
dancing: {
    // …
    effects: [ /* safe static fallback */ ],
    effectsBuilder: "getDancingEffects",
}
```

`activateState()` calls it automatically whenever the caller did not pass an
explicit `options.customEffects`, so every activation path — the Overview
toggle, a direct `activateState()`, a save/load restore — gets the same
level-correct effects. This generalises the older bespoke
`activateState(id, {customEffects: this.getLaunchMomentumEffects()})`
pattern; new features should prefer `effectsBuilder`.

The literal `effects` array should remain a sane fallback for any caller
that reads `ACTIVE_STATE_TYPES[x].effects` without an activation.

### States that require another state (`requiresStates`)

`requiresStates: ["dancing"]` makes a toggle **invisible** in
`getActivatableFeatures()` until its prerequisite state is running, and
`deactivateState` drops dependents automatically when the prerequisite ends.
This is how "while Dancing" abilities are gated — no bespoke visibility
logic required. Both Belly Dancer dependents use it:

- `tantalizingShivers` (Tantalizing Shivers, 9) — a bonus action that first
  resolves a contested check (see `contestedCheck` below), then grants
  attack advantage for 1 round.
- `percussiveStrike` (Percussive Strike, 17) — a free action granting attack
  advantage for as long as the Dance lasts; its save DC is
  `getPercussiveStrikeDc()` = 8 + PB + CHA.

Neither appears in `getActivatableFeatures()` until `dancing` is running,
and both are dropped when it ends.

### End-of-state saving throws (`endSave`)

A state type may declare a saving throw made **when the state ends**, with
declared consequences on a failure:

```javascript
endSave: {
    ability: "con",
    dc: 10,
    onFailure: {exhaustion: 1},
    label: "Dance of the Country",
}
```

`getStateEndSave(stateTypeId)` returns the descriptor;
`resolveStateEndSave(stateTypeId, {total})` applies the consequences and
returns `{success, dc, ability, exhaustionGained}`. The UI wiring lives in
`charactersheet.js` `_pResolveStateEndSave`, called from the "End" button on
an active state — the roll is made *after* deactivation so the state's own
bonuses don't inflate it.

### Activation-time contested checks (`activationInfo.contestedCheck`)

Some abilities only take effect if you win a contest. A detected activatable
feature may carry:

```javascript
contestedCheck: {
    skill: "performance",
    skillLabel: "Performance",
    ability: "cha",           // override ability — CHA (Performance)
    opposedBy: "Wisdom (Insight)",
}
```

`_activateFeatureState` rolls the character's side through
`_rollSkillCheck(skill, label, null, ability)` **before** deducting any
resource, then asks whether it beat the opposed roll. Losing the contest —
or cancelling — costs nothing. The opposing creature is not modelled by the
sheet, so the sheet rolls honestly and asks for the outcome rather than
inventing one.


### Activation-time rolled save DCs (`activationInfo.rolledSaveDc`)

A few abilities set their save DC from a check the actor rolls **at the moment
of use**, rather than the static `8 + proficiency + modifier` the sheet computes
everywhere else. The Jester's Privilege (TGTT Bard / College of Jesters, L14) is
the canonical case: *"Creatures within 60 feet … must make a Wisdom saving throw
(DC equal to your Performance check result)."*

The descriptor is derived from the feature's own prose by
`CharacterSheetState._buildRolledSaveDcInfo(text)`, so **any** feature phrased
this way inherits the behaviour with no name switch:

```javascript
rolledSaveDc: {
    skill: "performance",
    skillLabel: "Performance",
    ability: "cha",        // Performance is a Charisma skill
    saveAbility: "wis",    // what the targets roll
    range: 60,             // optional, from "within N feet"
}
```

`_pResolveRolledSaveDc` rolls the check **before** any resource is deducted
(so cancelling costs nothing) and reports the resulting DC. Returning a
descriptor rather than a number keeps the variable DC explicit instead of
silently substituting a static DC the feature never had.

Both halves of the derivation are required: prose that names a check-result DC
but no saving throw, or a saving throw against an ordinary static DC, yields
`null`. Without that guard every static-DC feature on the sheet would start
prompting for a roll.

The descriptor is attached in `getActivatableFeatures()` rather than inside
`detectActivatableFeature`, which has many return points.

#### The shared "roll before you pay" invariant

`contestedCheck`, `rolledSaveDc` and `endSave` are three descriptors of one
family, and they share a property that is **load-bearing and easy to break
silently**:

> The activation roll happens **before any resource is deducted**, so losing the
> contest — or dismissing the prompt — costs the player nothing.

`endSave` is the mirror image of the same principle: its save is rolled *after*
deactivation, so the state's own bonuses cannot inflate the roll that ends it.

Both orderings are invisible to a passing test. A refactor that moves the
resource spend above the roll, or the `endSave` roll above the teardown, leaves
every existing assertion green while quietly charging players for cancelled
activations or letting a state help its own escape. If you touch
`_pResolveContestedCheck`, `_pResolveRolledSaveDc`, `_pResolveStateEndSave` or
the ordering in `_activateFeatureState`, re-check this explicitly — the
Jester's Privilege tests pin the cancel-costs-nothing half.


### Speeds that track the walking speed

An active state can grant a speed that is *equal to* the character's walking
speed rather than a fixed number. Set `equalToWalk` instead of `value`; it is
resolved at the READ site (`getSpeed()` / `getSpeedByType()`), so a later boot
of Speed or a racial bonus is picked up automatically and the effect never
caches a stale number.

```javascript
{type: "flySpeed", equalToWalk: true}   // e.g. Circle of the Sea's Stormborn
{type: "swimSpeed", value: 30}          // a plain fixed value still works
```

> **Gotcha.** The description-text modifier pipeline is a *second, independent*
> source of speed grants: `_processFeatureModifiers` registers a `speed:<type>`
> `equalToWalk` named modifier parsed straight out of the feature's prose, and
> it is enabled unless `_extractCondition` recognises a gating phrase. A feature
> whose text reads "…confers two more benefits **while active**" needs that
> phrasing in `_extractCondition`, or the speed leaks as an always-on bonus even
> though the active state is off.

### Save-for-damage bursts (`trigger.effectType: "saveDamageBurst"`)

A state whose `trigger` declares `effectType: "saveDamageBurst"` gets a generic
"roll damage, name the save" button in the combat panel. The state's effect
descriptor may leave the scaling **unresolved** — `getActiveStateTrigger()`
resolves it — which keeps the effect provider out of the speed/calculation
re-entrancy cycle:

| Field | Meaning |
|---|---|
| `diceAbility` / `diceMinimum` / `dieSize` | `max(diceMinimum, mod(diceAbility))` dice of `dieSize` → `resolvedDamage` |
| `damage` | a literal formula, used when no `diceAbility` is given |
| `dcCalculation: "spellSaveDc"` | resolve the DC live → `resolvedDc` |
| `dc` | a literal DC, wins over `dcCalculation` |
| `saveAbility`, `damageType`, `range`, `pushDistance`, `maxPushSize` | surfaced in the roll result |

### Placement-aware states

`addActiveState` / `activateState` persist a `placement` string alongside the
other whitelisted option keys. `_getSupplementalActiveStateEffects(stateTypeId,
state)` receives the live state record, so a state can emit different effects
depending on where the player put it — Circle of the Sea's Oceanic Gift uses
this to withhold Stormborn's resistances and fly speed when the Emanation is
placed on an ally rather than on the druid.

---

## Supported Toggle Abilities

> ⚠️ **This section documents 32 of the 73 states in `ACTIVE_STATE_TYPES`.**
> The other 41 are **implemented and working** — they are merely undocumented
> here. Do not read a state's absence from this section as "unsupported"; check
> `CharacterSheetState.ACTIVE_STATE_TYPES` first, which is the only authority.
>
> This gap is machine-checked. `CharacterSheetToggleDocCoverage.test.js`
> enumerates the **runtime** object and asserts the undocumented set is exactly
> the list below, so a newly-added state cannot silently join it and a state
> that gets documented cannot silently linger. If that test fails, do not edit
> the list to make it pass without reading which direction it moved.
>
> <!-- TOGGLE_DOC_GAP:START — generated set; see CharacterSheetToggleDocCoverage.test.js -->
> `unearthlyCountenance` (Unearthly Countenance) ·
> `flyMyPretty` (Fly, My Pretty) ·
> `crimsonRite` (Crimson Rite) ·
> `shadowKnightDimLight` (Umbral Warrior: Dim Light/Darkness) ·
> `improvedShadowcastingAttack` (Improved Shadowcasting Attack) ·
> `shadowSneak` (Shadow Sneak) ·
> `defensiveStance` (Defensive Stance) ·
> `prone` (Prone) ·
> `wardingFlare` (Warding Flare) ·
> `coronaOfLight` (Corona of Light) ·
> `sacredWeapon` (Sacred Weapon) ·
> `smiteOfProtection` (Smite of Protection) ·
> `holyNimbus` (Holy Nimbus) ·
> `crownOfSpellfire` (Crown of Spellfire) ·
> `lunarPhaseFull` (Full Moon) ·
> `lunarPhaseNew` (New Moon) ·
> `lunarPhaseCrescent` (Crescent Moon) ·
> `combatStance` (Combat Stance) ·
> `zodiacForm` (Zodiac Form) ·
> `wrathOfTheSea` (Wrath of the Sea) ·
> `stepOfTheWind` (Step of the Wind) ·
> `steadyAim` (Steady Aim) ·
> `shellDefense` (Shell Defense) ·
> `fighterStance` (Combat Stance) ·
> `adamantineBull` (Adamantine Bull) ·
> `steelSerpent` (Steel Serpent) ·
> `weightlessMithral` (Weightless Mithral) ·
> `preciseStrike` (Precise Strike) ·
> `rhythmicStep` (Rhythmic Step) ·
> `craneParry` (Crane Parry) ·
> `jestersAct` (Jester's Act) ·
> `pantomime` (Pantomime) ·
> `tumbler` (Tumbler) ·
> `tricksterTrick` (Trickster's Trick) ·
> `metamagic` (Metamagic) ·
> `wardingSpell` (Warding Spell) ·
> `infernalMajesty` (Infernal Majesty) ·
> `hellishFrenzy` (Hellish Frenzy) ·
> `shadowShroud` (Shadow Shroud) ·
> `veilOfLies` (Veil of Lies) ·
> `hellsight` (Hellsight)
> <!-- TOGGLE_DOC_GAP:END -->

### Core D&D Abilities

#### Rage (Barbarian)
```javascript
rage: {
    effects: [
        {type: "advantage", target: "check:str"},
        {type: "advantage", target: "save:str"},
        {type: "resistance", target: "damage:bludgeoning"},
        {type: "resistance", target: "damage:piercing"},
        {type: "resistance", target: "damage:slashing"},
        {type: "rageDamage", target: "melee:str"},
    ],
    duration: "1 minute",
    resourceCost: 1,
    activationAction: "bonus",
}
```

Rage can receive subclass-scoped supplemental effects without changing the
global `rage` definition. Path of the Juggernaut uses this path for Spirit of
the Mountain (Prone and involuntary ground-movement immunity) and Unstoppable
(Frightened, Paralyzed, Prone, and Stunned immunity plus ignored speed
reductions). Existing conditions remain stored but their active-state effects
are suppressed while the immunity applies, then resume when Rage ends.

#### Manifest Chains (Path of the Chained Fury Barbarian, TGTT)

`manifestChains` is a **rage-gated sub-state** — the reference example of
`requiresStates` on a homebrew subclass. The RAW is "when you enter your rage,
you can choose to manifest spectral chains", so manifesting is a *choice made
within* rage rather than a second resource:

```javascript
manifestChains: {
    requiresStates: ["rage"],   // cannot activate until raging; cascades off with rage
    activationAction: "free",
    resourceCost: 0,
    preferCuratedEffects: true,
    duration: "While raging",
}
```

Three consequences fall out of `requiresStates` for free (see `astralBody`):
`activateState("manifestChains")` returns `null` while not raging,
`getActivatableFeatures()` omits the row entirely so the toggle is not even
offered, and `deactivateState("rage")` cascades the chains off.

The state gates the granted **Spectral Chains** attack (`requiresState:
"manifestChains"` on the `grantedAttacks` descriptor), so the weapon appears in
the Combat tab only while the chains are actually manifested. Because the state
is nested inside Rage, the chains inherit Rage's `breaksConcentration` and its
`exclusiveWith: ["bladesong"]` without restating either.

#### Resolute Stance (Juggernaut Barbarian)
`resoluteStance` is a free, start-of-turn state which expires at the start of
the next turn. It grants Grappled immunity, imposes disadvantage on the
Juggernaut's weapon attacks, and exposes disadvantage on attacks against the
Juggernaut through the normal defense-effect pipeline.

#### Bladesong (Bladesinger Wizard)
```javascript
bladesong: {
    effects: [
        {type: "bonus", target: "ac", abilityMod: "int"},
        {type: "bonus", target: "speed:walk", value: 10},
        {type: "advantage", target: "skill:acrobatics"},
        {type: "bonus", target: "concentration", abilityMod: "int"},
    ],
    duration: "1 minute",
    resourceCost: 1, // Uses per proficiency bonus
    activationAction: "bonus",
}
```

#### Wild Shape (Druid)
```javascript
wildShape: {
    effects: [
        {type: "replaceStats", targets: ["str", "dex", "con"]},
        {type: "replaceHp", target: "tempHp"},
        {type: "replaceAc", target: "naturalArmor"},
    ],
    duration: "Hours based on druid level",
}
```

#### Hybrid Transformation (Blood Hunter: Order of the Lycan)

Hybrid Transformation uses a short-rest pool (one use at level 3, two at level
11, unlimited at level 18). Its state supplies Strength check/save advantage,
conditional nonsilvered nonmagical B/P/S resistance, the Predatory Strike
natural weapon, transformed walking-speed bonus, Lycan attack/damage scaling,
and the non-heavy-armor AC bonus. Conditional resistance metadata remains
qualified in the Defenses display rather than appearing as unconditional B/P/S
resistance.
Level 11 regeneration is applied when combat rounds advance while the Lycan is
below half hit points, including the first turn when combat starts. Starting a
turn below half hit points also rolls the
Bloodlust Wisdom save (with Brand of the Voracious advantage, or automatic
failure while concentrating/Raging). Finite transformations end during a rest;
level 18 mastery transformations remain active until manually ended. Any Lycan
automatically reverts at 0 HP.

Crimson Rite is a separate active state created from a selected `CR` optional
feature. Activation rolls the Hemocraft Die as an HP cost, records the selected
weapon (including Predatory Strike), and adds the rite's typed damage only to
that weapon. Predatory Strike exposes both its bludgeoning and slashing damage
choices as rollable attacks while sharing one rite-empowered weapon identity.

#### Reckless Attack (Barbarian)
```javascript
recklessAttack: {
    effects: [
        {type: "advantage", target: "attack:melee:str"},
        {type: "advantage", target: "attacksAgainst"},
    ],
    duration: "This turn",
    requiresClass: "barbarian",
    requiresClassLevel: 2,
}
```

#### Patient Defense (Monk)
```javascript
patientDefense: {
    effects: [
        {type: "disadvantage", target: "attacksAgainst"},
        {type: "advantage", target: "save:dex"},
    ],
    duration: "Until start of next turn",
    resourceName: "Ki Points",
    resourceCost: 1,
    activationAction: "bonus",
}
```

#### Dodge (universal action)
```javascript
dodge: {
    name: "Dodging",
    effects: [
        {type: "disadvantage", target: "attacksAgainst"},
        {type: "advantage", target: "save:dex"},
    ],
    duration: "Until start of next turn",
}
```
The plain Dodge action, available to every character. Mechanically identical
to Patient Defense but with no resource cost and no bonus-action activation.
Note the distinction from the `grantsActionBenefit: "dodge"` *effect*
described above: that effect grants Dodge's benefit **without** taking the
action, whereas this state models actually having taken it.

#### Sun Shield (Sun Soul Monk)
```javascript
sunShield: {
    effects: [
        {
            type: "retaliationDamage",
            target: "meleeAttacker",
            value: 5,
            abilityMod: "wis",
            damageType: "radiant",
        },
    ],
    trigger: {
        label: "Retaliate",
        actionType: "reaction",
        effectType: "retaliationDamage",
    },
    duration: "Until extinguished",
    activationAction: "bonus",
}
```

Triggered active-state effects are resolved through
`getActiveStateTrigger()`. It adds any configured ability modifier to the
effect value, then the Combat tab renders the trigger as a real action-economy
control. Sun Shield therefore deals `5 + WIS` radiant damage and consumes the
character's reaction while combat tracking is active.

#### Exalted Champion (Oath of the Crown Paladin, L20)

```javascript
exaltedChampion: {
    preferCuratedEffects: true,
    effects: [
        {type: "resistance", target: "damage:bludgeoning"},
        {type: "resistance", target: "damage:piercing"},
        {type: "resistance", target: "damage:slashing"},
        {type: "advantage", target: "save:wis"},
    ],
    duration: "1 hour",
    activationAction: "action",
    resourceName: "Exalted Champion",
}
```

Two conventions this state exists to demonstrate:

**Damage-defence targets must be namespaced.** A `resistance` / `immunity` /
`vulnerability` effect is read through `_getDamageDefenceFromStates`, which
accepts `damage:<type>` (the canonical form — always emit this) and, since
CS-BUG-050, a bare damage type from the prose parser. Non-damage targets such
as `"ac"` or `"speed:walk"` are whitelist-rejected, so they can never be
mistaken for a damage type. Advantage, by contrast, uses the **bare** form:
`save:wis`, `check:wis`, `skill:perception`.

**`preferCuratedEffects: true`** pins the curated `effects` array in place of
whatever `parseEffectsFromDescription` extracts from the feature text. Use it
whenever the prose is lossy — here the parse duplicated bludgeoning and dropped
the "from nonmagical weapons" caveat. Without the flag, a non-empty parse wins.

#### Umbral Form (Shadow Magic Sorcerer, L18)

```javascript
umbralForm: {
    preferCuratedEffects: true,
    effects: [
        {type: "resistance", target: "damage:acid"},
        {type: "resistance", target: "damage:bludgeoning"},
        // …9 more: cold, fire, lightning, necrotic, piercing, poison,
        //          psychic, slashing, thunder — every type EXCEPT force
        //          and radiant.
    ],
    duration: "1 minute",
    activationAction: "bonus",
    resourceName: "Sorcery Points",
    resourceCost: 6,
}
```

"Resistance to all damage except force and radiant" has to be enumerated. There
is no exclusion syntax, and there deliberately isn't one — a wildcard-minus-list
form would have to be re-resolved every time the damage-type table changes, and
`_getDamageDefenceFromStates` would lose its whitelist guarantee. Eleven explicit
`damage:<type>` entries are also self-documenting at the call site and let a test
assert the exact count (11 while active), which is a stronger probe than "force
is not in the list".

`resourceCost: 6` on the state definition is what `getActivatableFeatures()`
resolves the Sorcery Point spend from; `_findResource` matches
`"Sorcery Points"` bidirectionally, so a feature declaring
`consumes: {name: "Sorcery Point"}` (singular) resolves to the same pool.

**Name collisions.** Umbral Form's sibling states in the TGTT Shadow Knight
tree (`eyesOfTheDark`, `umbralCoating`, `shadowCloak`, `shadowKnightDarkness`)
all carry `noNameDetect: true` — see CS-BUG-083. `detectActivatableFeature()`
is static and matches purely on feature name, so without the flag a Shadow
Magic Sorcerer's *passive* "Eyes of the Dark" was classified as the Shadow
Knight's activatable state of the same name. Add `noNameDetect: true` to any
state whose name is generic enough to appear in unrelated content; such states
are then reachable only through an explicit `activateState(key)` call or a
`FEATURE_CLASSIFICATION_OVERRIDES` entry.

#### Umbral Form (Shadow **Sorcery** Sorcerer, RHW, L18)

The 2024 rework shares its *name* with the XGE state above but almost none of
its mechanics, which is why it needs a second state and a source-aware way to
reach it.

```javascript
umbralFormRhw: {
    noNameDetect: true,               // the name is taken; see below
    preferCuratedEffects: true,
    effects: [
        // The same 11 curated `damage:<type>` resistances as `umbralForm` —
        // RAW excludes BOTH force and radiant in both editions.
        …,
        {type: "info", text: "Incorporeal Movement: … 1d10 Force damage …"},
    ],
    requiresStates: ["innateSorcery"], // ← the binding
    duration: "While Innate Sorcery is active",
    activationAction: "free",
    // NO resourceName / resourceCost: entering is FREE and costs one of the
    // feature's own 1/long-rest uses. 6 Sorcery Points RESTORE a use instead.
}
```

**Two mechanisms worth reusing.**

`requiresStates` makes the binding bidirectional for free: `activateState()`
returns `null` while Innate Sorcery is inactive, and `deactivateState(id)`
already cascades off every state whose `requiresStates` names it — so ending
Innate Sorcery ends Umbral Form and takes the 11 resistances with it, with no
bespoke teardown code.

**Disambiguating a name collision by SOURCE.** `noNameDetect: true` was not
enough here: `Umbral Form|RHW` needs to reach *a* state, just not the XGE one.
`detectActivatableFeature()` therefore consults a `stateBySourceOverrides` table
**before** the generic name-matching loop:

```javascript
const stateBySourceOverrides = {"umbral form": {rhw: "umbralFormRhw"}};
```

A hit returns `matchedBy: "nameAndSource"`. Prefer this over inventing a
distinct state name when the product name genuinely is shared — the player sees
"Umbral Form" on both sheets and the feature list should say so.

#### Innate Sorcery (Sorcerer, XPHB, L1)

```javascript
innateSorcery: {
    preferCuratedEffects: true,
    effects: [
        {type: "bonus", target: "spellDc", value: 1},
        {type: "advantage", target: "attack:spell"},
    ],
    duration: "1 minute",
    activationAction: "bonus",
    resourceName: "Innate Sorcery",
    resourceCost: 1,
}
```

A base-class feature, implemented alongside Shadow Sorcery because Umbral Form
hangs off it. `spellDc` was an **advertised effect target with no reader**
(CS-BUG-099), and the Spells tab's own per-class card then hand-rolled the DC
and ignored it a second time (CS-BUG-102) — so a `{type: "bonus", target:
"spellDc"}` effect is now worth checking end-to-end when you add one.
#### Launch Momentum (Steel Hawk Fighter, `GriffonsSaddlebag2`)

```javascript
launchMomentum: {
    name: "Launch Momentum",
    icon: "🦅",
    activationAction: "bonus",
    // Armed by useLaunch(); eaten by the next melee attack.
    consumeOnAttack: true,
    // "Launch" is a generic English word — never name-detect it.
    noNameDetect: true,
}
```

The effects are supplied per-activation by `getLaunchMomentumEffects()` rather
than being fixed on the state type, because all three riders are level-scaled:

```javascript
[
    {type: "advantage", target: "attack:melee"},
    // "of the weapon's type" — left untyped so the roller reports it under the
    // weapon's own damage type instead of inventing one.
    {type: "extraDamage", value: "1d8"|"1d10"|"1d12", damageType: "", meleeOnly: true},
    {type: "critRange", value: 19},   // Eagle Eye, level 10+ only
]
```

Two conventions worth copying:

**`meleeOnly` is honoured by the damage roller.** `getExtraDamageFromStates()`
propagates the flag and `_rollDamage` filters on it, so a rider that reads "on a
melee weapon attack" cannot leak onto a ranged attack or a spell.

**`target: "attack:melee"` matches a `"attack:melee:str"` query.** Both
advantage aggregators — `hasAdvantageFromStates()` (the roll path) and
`_effectMatchesType()` (the badge path, via `getAdvantageState()`) — honour the
hierarchical attack prefix. They did not agree before CS-BUG-087.

#### Eagle Eye Sight (Steel Hawk Fighter, `GriffonsSaddlebag2`)

```javascript
eagleEyeSight: {
    name: "Eagle Eye Sight",
    icon: "👁️‍🗨️",
    activationAction: "free",
    noNameDetect: true,
}
```

A player-driven toggle rather than a passive bonus, because the doubled
proficiency applies only to **sight-based** Wisdom (Perception) checks and the
sheet cannot know which checks those are. `setEagleEyeSightActive(true)` supplies
`customEffects: [{type: "bonus", target: "skill:perception", value: …}]`, where
the value is **0** when Perception is already expertise — doubling an
already-doubled bonus is worth nothing. Note this state is why CS-BUG-086 was
found: `skill:<name>` bonus targets were being discarded outright by
`getSkillBonusFromStates()`.

### Combat Stances (TGTT/Homebrew)

#### Astral Self (Way of the Astral Self Monk)

Four cooperating states — `astralArms` (level 3), `astralVisage` (6),
`astralBody` (11) and `awakenedAstralSelf` (17). They demonstrate three
patterns worth reusing:

**State dependencies.** `astralBody` declares
`requiresStates: ["astralArms", "astralVisage"]` and cannot be activated
until both are present. It also declares `endConditions` naming its
prerequisites, so it tears down automatically when either ends.

```javascript
astralBody: {
    requiresStates: ["astralArms", "astralVisage"],
    endConditions: ["Arms or Visage ends", "You are incapacitated or die"],
    activationAction: "free",
    resourceCost: 0,
    trigger: {label: "Deflect Energy", actionType: "reaction", effectType: "damageReduction"},
}
```

**Conditional, relative reach.** Astral Arms grants an attack whose reach is
*five feet greater than normal, on your turn only* — not a flat ten feet. The
granted attack carries `reachBonus` and `reachCondition` rather than an
absolute `reach`, so it composes correctly with a Large creature, the Reach
weapon property and any other reach modifier:

```javascript
{damage: martialArtsDice, damageType: "force", abilityMod: "wis",
 reachBonus: 5, reachCondition: "onYourTurn", isMelee: true}
```

`getAttackReach(attack, {isOwnTurn})` returns `base + reachProperty +
attackReachBonus`, zeroing the bonus when `reachCondition` is `onYourTurn`
and the roll is off-turn. Prefer this shape over a hardcoded reach for any
future feature that extends reach situationally.

**Generic incapacitated/death teardown.** `_deactivateStatesForEndCondition()`
reads each state's own `endConditions` strings and deactivates every active
state whose conditions mention incapacitation, unconsciousness or death. It is
called from `setCurrentHp()`, `setHp()`, `addCondition()` and
`setConditions()`, so any state that documents such an end condition gets
correct teardown for free — no per-feature hook. This replaced a hardcoded
`deactivateState("hybridTransformation")` at 0 HP; Blood Hunter's Lycan
transformation now tears down through the same path because its
`endConditions` already listed `"Unconscious"`.

#### Heavy Stance (Adamant Mountain)
```javascript
heavyStance: {
    effects: [
        {type: "bonus", target: "check:str:athletics", useProficiency: true},
        {type: "bonus", target: "save:resist-movement", useProficiency: true},
        {type: "note", value: "Ignore first 10 ft of difficult terrain each turn"},
    ],
    resourceName: "Stamina",
    resourceCost: 1,
    activationAction: "bonus",
}
```

#### Stand Tall Stance
```javascript
standTallStance: {
    effects: [
        {type: "sizeIncrease", value: 1},
        {type: "note", value: "Creatures smaller than you have disadvantage on saves vs your combat methods"},
    ],
    resourceName: "Stamina",
    resourceCost: 1,
}
```

#### Iron Punisher
```javascript
ironPunisher: {
    effects: [
        {type: "advantage", target: "attack:melee"},
        {type: "advantage", target: "attacksAgainst"},
    ],
    activationAction: "free",
}
```

---

## Detection System

### How Detection Works

When features are loaded, the system analyzes them for toggle capability:

```javascript
static detectActivatableFeature(feature) {
    const name = feature.name?.toLowerCase() || "";
    const text = this._getFeatureText(feature);
    
    // Check each state type's detect patterns
    for (const [stateTypeId, stateType] of Object.entries(this.ACTIVE_STATE_TYPES)) {
        if (!stateType.detectPatterns?.length) continue;
        
        for (const pattern of stateType.detectPatterns) {
            const regex = new RegExp(pattern, "i");
            if (regex.test(name) || regex.test(text)) {
                return {stateTypeId, stateType, matchedPattern: pattern};
            }
        }
    }
    
    // Fallback: analyze text for toggle-like patterns
    return this.analyzeToggleability(text);
}
```

### Toggle Analysis

For features without explicit patterns, the system analyzes the text:

```javascript
static analyzeToggleability(text) {
    const plainText = text.replace(/<[^>]*>/g, " ").toLowerCase();
    
    // Activation phrases
    const activationPatterns = [
        /as a bonus action.*you can/i,
        /you can use.*bonus action to/i,
        /when you.*enter/i,
        /while (this|the) (effect|stance|state) is active/i,
    ];
    
    // Duration phrases
    const durationPatterns = [
        /lasts? (for )?(\d+) (minute|hour|round)/i,
        /until (the (start|end) of your (next )?turn|you (end|dismiss) it)/i,
        /for the duration/i,
    ];
    
    // Check for matches
    const hasActivation = activationPatterns.some(p => p.test(plainText));
    const hasDuration = durationPatterns.some(p => p.test(plainText));
    
    if (hasActivation || hasDuration) {
        return {
            isToggle: true,
            activationType: this._detectActivationType(plainText),
            duration: this._extractDuration(plainText),
        };
    }
    
    return {isToggle: false};
}
```

---

## Active State Management

### State Data Structure

```javascript
// In CharacterSheetState._data
activeStates: [
    {
        id: "rage_1234567890",        // Unique instance ID (typeId + timestamp)
        stateTypeId: "rage",          // Type from ACTIVE_STATE_TYPES
        name: "Rage",                 // Display name
        icon: "💢",                   // Display icon
        description: null,            // Optional feature description
        active: true,                 // Currently active?
        activatedAt: 1234567890,      // Real-world timestamp (Date.now())
        activatedAtRound: 1,          // Combat round when activated (null if outside combat)
        sourceFeatureId: null,        // Link to source feature
        resourceId: null,             // Link to resource spent
        customEffects: [],            // Additional effects from feature
        spellName: null,              // For concentration states
        spellLevel: null,             // For concentration states
        concentration: false,         // Is concentration state?
        isSpellEffect: false,         // From a spell?
        duration: "1 minute",         // Display duration string
        roundsRemaining: 10,          // Rounds left (null = indefinite, decremented by advanceRound)
        grantsConditions: null,       // Conditions granted by this state
        beastData: null,              // For Wild Shape beast form
    },
]
```

### Activating a State

```javascript
activateState(stateTypeId, options = {}) {
    const stateType = CharacterSheetState.ACTIVE_STATE_TYPES[stateTypeId];

    // Enforce mutual exclusivity (e.g., Rage vs Bladesong)
    if (stateType?.exclusiveWith?.length) {
        for (const exclusiveId of stateType.exclusiveWith) {
            this.deactivateState(exclusiveId);
        }
    }

    // States that break concentration (e.g., Rage)
    if (stateType?.breaksConcentration && this._data.concentrating) {
        this.breakConcentration();
    }

    // Reactivate existing or create new
    const existing = this._data.activeStates.find(s => s.stateTypeId === stateTypeId);
    if (existing) {
        existing.active = true;
        existing.activatedAt = Date.now();
        existing.activatedAtRound = this._data.inCombat ? this._data.combatRound : null;
        existing.roundsRemaining = this._data.inCombat
            ? CharacterSheetState.parseDurationToRounds(existing.duration) : null;
        return existing.id;
    }
    return this.addActiveState(stateTypeId, options);
}
```

### Combat Round Tracking

```javascript
// Start/end combat lifecycle
startCombat()              // Sets inCombat=true, combatRound=1, stamps activatedAtRound on active states
endCombat()                // Clears inCombat, combatRound, and all roundsRemaining/activatedAtRound

// Advance round — auto-deactivates expired states
const expired = advanceRound();  // Returns array of expired state names
// e.g. expired = ["Dodging"] after a 1-round Dodge expires

// Parse duration string to rounds
CharacterSheetState.parseDurationToRounds("1 minute")       // → 10
CharacterSheetState.parseDurationToRounds("Concentration, up to 10 minutes") // → 100
CharacterSheetState.parseDurationToRounds("Until ended")    // → null (indefinite)
```

### Deactivating States

```javascript
deactivateState(stateTypeId) {
    const state = this._data.activeStates.find(s => s.stateTypeId === stateTypeId);
    if (state) {
        state.active = false;
    }
}

removeActiveState(stateId) {
    const index = this._data.activeStates.findIndex(s => s.id === stateId);
    if (index !== -1) {
        this._data.activeStates.splice(index, 1);
    }
}
```
    
    return true;
}

deactivateStatesByType(stateTypeId) {
    const toRemove = this._data.activeStates.filter(s => s.stateTypeId === stateTypeId);
    toRemove.forEach(state => this.removeActiveState(state.id));
}
```

### Checking Active States

```javascript
isStateTypeActive(stateTypeId) {
    return this._data.activeStates.some(s => s.stateTypeId === stateTypeId);
}

getActiveStates() {
    return this._data.activeStates.map(state => ({
        ...state,
        stateType: CharacterSheetState.ACTIVE_STATE_TYPES[state.stateTypeId] ||
            CharacterSheetState.ACTIVE_STATE_TYPES.homebrewToggle,
    }));
}

getActiveStateEffects() {
    const effects = [];
    
    this._data.activeStates.forEach(state => {
        const stateType = CharacterSheetState.ACTIVE_STATE_TYPES[state.stateTypeId];
        if (!stateType) return;
        
        // Add base effects
        effects.push(...stateType.effects.map(e => ({
            ...e,
            source: state.name,
            stateId: state.id,
        })));
        
        // Add custom effects
        if (state.customEffects) {
            effects.push(...state.customEffects.map(e => ({
                ...e,
                source: state.name,
                stateId: state.id,
            })));
        }
    });
    
    return effects;
}
```

---

## Effect Application

### In AC Calculation

```javascript
getAc() {
    let ac = this._calculateBaseAc();
    
    // Apply active state effects
    const stateEffects = this.getActiveStateEffects();
    stateEffects.forEach(effect => {
        if (effect.type === "bonus" && effect.target === "ac") {
            if (effect.value) {
                ac += effect.value;
            } else if (effect.abilityMod) {
                ac += Math.max(1, this.getAbilityMod(effect.abilityMod));
            }
        }
    });
    
    return ac;
}
```

### In Attack Rolls

```javascript
_getAttackAdvantageStatus() {
    const stateEffects = this.getActiveStateEffects();
    
    let hasAdvantage = false;
    let hasDisadvantage = false;
    
    stateEffects.forEach(effect => {
        if (effect.type === "advantage" && effect.target?.startsWith("attack")) {
            hasAdvantage = true;
        }
        if (effect.type === "disadvantage" && effect.target?.startsWith("attack")) {
            hasDisadvantage = true;
        }
    });
    
    // Advantage and disadvantage cancel out
    if (hasAdvantage && hasDisadvantage) {
        return "normal";
    }
    return hasAdvantage ? "advantage" : hasDisadvantage ? "disadvantage" : "normal";
}
```

### In Damage Calculation

```javascript
_calculateMeleeDamageBonus() {
    let bonus = 0;
    
    // Check for rage damage
    if (this.isStateTypeActive("rage")) {
        const calc = this.getFeatureCalculations();
        bonus += calc.rageDamage || 0;
    }
    
    // Check other damage bonuses from active states
    const stateEffects = this.getActiveStateEffects();
    stateEffects.forEach(effect => {
        if (effect.type === "bonus" && effect.target === "damage:melee") {
            bonus += effect.value || 0;
        }
    });
    
    return bonus;
}
```

---

## UI Integration

### Toggle Controls

The UI renders toggle buttons for activatable features:

```javascript
_renderToggleControls() {
    const activatables = this._state.getActivatableFeatures();
    
    activatables.forEach(feature => {
        const isActive = this._state.isFeatureActive(feature.id);
        
        const $toggle = $(`
            <button class="charsheet__toggle ${isActive ? "active" : ""}" 
                    data-feature-id="${feature.id}"
                    data-state-type="${feature.stateTypeId}">
                <span class="charsheet__toggle-icon">${feature.icon}</span>
                <span class="charsheet__toggle-name">${feature.name}</span>
            </button>
        `);
        
        $toggle.click(() => this._onToggleClick(feature));
    });
}
```

### Active Effects Display

```javascript
_renderActiveEffects() {
    const $container = $("#charsheet-active-effects");
    $container.empty();
    
    const activeStates = this._state.getActiveStates();
    
    if (activeStates.length === 0) {
        $container.append(`<div class="charsheet__no-effects">No active effects</div>`);
        return;
    }
    
    activeStates.forEach(state => {
        const $effect = $(`
            <div class="charsheet__active-effect" data-state-id="${state.id}">
                <span class="charsheet__effect-icon">${state.stateType.icon}</span>
                <span class="charsheet__effect-name">${state.name}</span>
                <button class="charsheet__effect-remove" title="Deactivate">✕</button>
            </div>
        `);
        
        $effect.find(".charsheet__effect-remove").click(() => {
            this._state.removeActiveState(state.id);
            this._renderActiveEffects();
        });
        
        $container.append($effect);
    });
}
```

### Effect Summaries

`summarizeEffects()` produces human-readable labels from effect definitions, used in combat UI badges:

```javascript
CharacterSheetState.summarizeEffects(patientDefense.effects);
// → "Attacks against you have disadvantage; Advantage on DEX saves"
```

These labels appear in the combat panel when a state is active, providing at-a-glance visibility of mechanical effects.

### Patient Defense — Enhanced Display (Phase C/E)

Patient Defense is intentionally a **toggle state** (not a combat action) because its effects are ongoing and benefit from the state tracking system (round countdown, deactivation cleanup, effect aggregation).

**Visual feedback enhancements:**
- **Inline effect labels**: When Patient Defense is active, the combat panel shows "Attackers have disadvantage • Advantage on DEX saves"
- **`summarizeEffects()`** generates these labels from the `effects` array
- **Heightened Focus variant** (Monk XPHB L10): Also grants temp HP equal to `martialArtsDice + WIS mod` on Patient Defense activation
- **Deactivation**: `removeActiveState()` clears all effects, including temp HP if Heightened Focus granted it

**Test coverage** (in `CharacterSheetToggleAbilities.test.js`):
- State type definition shape (effects, resourceName, resourceCost, activationAction, duration)
- `summarizeEffects()` output string
- Activation via `activateState()` and `isStateTypeActive()` check
- Disadvantage on attacksAgainst present in effects array (note: `hasDisadvantageFromStates()` intentionally skips `attacksAgainst` — those affect enemies, not the player's rolls)
- Advantage on DEX saves via `hasAdvantageFromStates("save:dex")`
- Deactivation cleanup
- `analyzeToggleability()` recognition from feature text
- Heightened Focus temp HP formula

---

## Testing

The toggle abilities system has comprehensive test coverage:

### Test File Location
`test/jest/charactersheet/CharacterSheetToggleAbilities.test.js`

### Test Categories

1. **ACTIVE_STATE_TYPES validation** - Ensures all state types have required properties
2. **Detection tests** - Verifies correct identification of toggle abilities
3. **Activation/deactivation** - Tests state lifecycle management
4. **Effect application** - Verifies effects are correctly applied to calculations
5. **Resource consumption** - Tests that resources are properly consumed
6. **Class-specific tests** - Rage, Bladesong, Patient Defense, etc.

### Example Tests

```javascript
describe("Rage activation", () => {
    it("should activate rage and apply effects", () => {
        const state = createBarbarian(5);
        
        state.addActiveState("rage");
        
        expect(state.isStateTypeActive("rage")).toBe(true);
        
        const effects = state.getActiveStateEffects();
        expect(effects.some(e => e.type === "resistance" && e.target === "damage:bludgeoning")).toBe(true);
    });
    
    it("should consume a rage use", () => {
        const state = createBarbarian(5);
        const initialRages = state.getResourceCurrent("rage");
        
        state.addActiveState("rage");
        
        expect(state.getResourceCurrent("rage")).toBe(initialRages - 1);
    });
});
```

---

*Previous: [Spellcasting](./07-spellcasting.md) | Next: [Testing Strategy](./09-testing-strategy.md)*
